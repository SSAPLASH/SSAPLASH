import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/error';
import type { RecordingBody, RecordingSummary } from '@/domain/play/recording';
import type { ResolvedHit } from '@/domain/events';
import type { LoggedHit } from '@/domain/play/playLog';

vi.mock('@/api/play/recordings', () => ({ saveRecording: vi.fn() }));
vi.mock('./playSync', () => ({ startPlaySync: vi.fn() }));
vi.mock('./sources', () => {
  const listeners = new Set<(h: ResolvedHit) => void>();
  return {
    inputManager: {
      onHit: (cb: (h: ResolvedHit) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      __emit: (h: ResolvedHit) => [...listeners].forEach((l) => l(h)),
      __count: () => listeners.size,
    },
  };
});

import { saveRecording } from '@/api/play/recordings';
import { startPlaySync } from './playSync';
import {
  consumeNotice,
  discard,
  disarm,
  finishSong,
  resetRecordingForTest,
  retry,
  save,
  setLocked,
  startFree,
  stopFree,
  toggleArm,
  useRecordingStore,
} from './recordingStore';
import { inputManager } from './sources';

const api = vi.mocked(saveRecording);
const playSync = vi.mocked(startPlaySync);
const bus = inputManager as unknown as { __emit: (h: ResolvedHit) => void; __count: () => number };
const state = () => useRecordingStore.getState();
const SUMMARY = { id: 7 } as RecordingSummary;

function hit(over: Partial<ResolvedHit> = {}): ResolvedHit {
  return { id: 1, stickId: 0, pad: 'SNARE', velocity: 100, tHit: performance.now(), source: 'keyboard', ...over } as ResolvedHit;
}

function logged(tSongMs: number, over: Partial<LoggedHit> = {}): LoggedHit {
  return { hitId: 1, stickId: 0, pad: 'SNARE', velocity: 90, tHit: 0, tRecv: 0, tResolved: 0, tSongMs, source: 'keyboard', ...over };
}

const SONG = { title: '곡', durationMs: 60_000 };
const finishArgs = (hits: LoggedHit[] = [logged(100), logged(200)]) => ({
  mode: 'RHYTHM' as const,
  hits,
  chart: SONG,
  startedAt: new Date(2026, 10, 3, 9, 5),
  playId: 'play-1',
});

const done = { status: 'DONE', reason: null, retryable: false, attempts: 1, updatedAt: '' } as never;
const skipped = { status: 'SKIPPED', reason: 'x', retryable: false, attempts: 0, updatedAt: '' } as never;
const busy = () => new ApiError(503, 'RECORDING_BUSY', 'busy');

/** 자유 녹음을 한 번 하고 pendingSave까지 */
function freeToPending() {
  startFree();
  bus.__emit(hit());
  stopFree('user');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetRecordingForTest();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetRecordingForTest();
  vi.useRealTimers();
});

describe('자유 녹음', () => {
  it('startFree는 recording으로 가고 onHit를 구독한다', () => {
    startFree();
    expect(state().phase).toBe('recording');
    expect(bus.__count()).toBe(1);
    expect(state().free).not.toBeNull();
  });

  it('타격이 쌓이고 정지하면 pendingSave, 구독이 풀린다', () => {
    startFree();
    bus.__emit(hit());
    bus.__emit(hit({ pad: 'KICK' }));
    expect(state().free?.hitCount).toBe(2);
    stopFree('user');
    expect(state().phase).toBe('pendingSave');
    expect(state().stopReason).toBe('user');
    expect(state().pending).toMatchObject({ mode: 'FREE', songTitle: null, playId: null, body: null });
    expect(state().pending?.hits).toHaveLength(2);
    expect(state().pending?.clientKey).toMatch(/\S/);
    expect(bus.__count()).toBe(0);
    // 정지 후 타격은 쌓이지 않는다
    bus.__emit(hit());
    expect(state().pending?.hits).toHaveLength(2);
  });

  it('pad가 없는 타격은 세지 않는다', () => {
    startFree();
    bus.__emit(hit({ pad: null }));
    expect(state().free?.hitCount).toBe(0);
  });

  it('센서 타격이 있으면 hasSensor', () => {
    startFree();
    bus.__emit(hit({ source: 'stick' as never, stickId: 1 }));
    stopFree('user');
    expect(state().pending?.hasSensor).toBe(true);
  });

  it('타격이 0개면 idle + noHits 알림', () => {
    startFree();
    stopFree('user');
    expect(state().phase).toBe('idle');
    expect(state().pending).toBeNull();
    expect(consumeNotice()).toEqual({ kind: 'noHits' });
    expect(consumeNotice()).toBeNull();
    expect(bus.__count()).toBe(0);
  });

  it('baseDurationMs는 정지 − 시작', () => {
    startFree();
    bus.__emit(hit());
    vi.advanceTimersByTime(5000);
    stopFree('user');
    expect(state().pending?.baseDurationMs).toBeGreaterThanOrEqual(5000);
    expect(state().pending?.baseDurationMs).toBeLessThan(5100);
  });

  it('50,000타에 닿으면 자동 정지(limit)', () => {
    startFree();
    for (let i = 0; i < 50_000; i++) bus.__emit(hit());
    expect(state().phase).toBe('pendingSave');
    expect(state().stopReason).toBe('limit');
    expect(state().pending?.hits).toHaveLength(50_000);
    expect(bus.__count()).toBe(0);
  });

  it('2시간이 지나면 타이머로 자동 정지(limit)', () => {
    startFree();
    bus.__emit(hit());
    vi.advanceTimersByTime(7_200_000);
    expect(state().phase).toBe('pendingSave');
    expect(state().stopReason).toBe('limit');
  });

  it('이탈로 정지하면 stopReason이 leave', () => {
    startFree();
    bus.__emit(hit());
    stopFree('leave');
    expect(state().stopReason).toBe('leave');
  });

  it('recording이 아닐 때 stopFree는 무시', () => {
    stopFree('user');
    expect(state().phase).toBe('idle');
    expect(consumeNotice()).toBeNull();
  });
});

describe('게임·악보 finishSong', () => {
  it('armed가 아니면 무시한다', () => {
    finishSong(finishArgs());
    expect(state().phase).toBe('idle');
    expect(state().pending).toBeNull();
  });

  it('armed면 pendingSave, 기본 제목·길이·playId 후보를 채우고 잠금을 푼다', () => {
    toggleArm();
    setLocked(true);
    finishSong(finishArgs());
    expect(state().phase).toBe('pendingSave');
    expect(state().locked).toBe(false);
    const p = state().pending!;
    expect(p).toMatchObject({ mode: 'RHYTHM', songTitle: '곡', baseDurationMs: 60_000, playId: 'play-1', body: null });
    expect(p.defaultTitle).toBe('곡 · 11월 3일 09:05');
    expect(p.hits).toHaveLength(2);
    expect(p.clientKey).toMatch(/\S/);
  });

  it('변환 결과가 0개면 idle + noHits', () => {
    toggleArm();
    finishSong(finishArgs([logged(-5), logged(10, { pad: null })]));
    expect(state().phase).toBe('idle');
    expect(consumeNotice()).toEqual({ kind: 'noHits' });
  });
});

describe('toggleArm·잠금', () => {
  it('idle ↔ armed', () => {
    toggleArm();
    expect(state().phase).toBe('armed');
    toggleArm();
    expect(state().phase).toBe('idle');
  });

  it('locked면 무시', () => {
    setLocked(true);
    toggleArm();
    expect(state().phase).toBe('idle');
    setLocked(false);
    toggleArm();
    setLocked(true);
    toggleArm();
    expect(state().phase).toBe('armed');
  });

  it('녹음 중·저장 창 단계에서는 무시', () => {
    startFree();
    toggleArm();
    expect(state().phase).toBe('recording');
    bus.__emit(hit());
    stopFree('user');
    toggleArm();
    expect(state().phase).toBe('pendingSave');
  });

  it('저장 창 단계에서는 startFree도 무시', () => {
    freeToPending();
    const key = state().pending?.clientKey;
    startFree();
    expect(state().phase).toBe('pendingSave');
    expect(state().pending?.clientKey).toBe(key);
    expect(bus.__count()).toBe(0);
  });

  it('disarm은 armed를 idle로 돌리고 잠금을 푼다', () => {
    toggleArm();
    setLocked(true);
    disarm();
    expect(state().phase).toBe('idle');
    expect(state().locked).toBe(false);
  });

  it('disarm은 저장 창 단계를 건드리지 않는다', () => {
    freeToPending();
    disarm();
    expect(state().phase).toBe('pendingSave');
  });
});

describe('저장', () => {
  it('자유: 저장 성공이면 idle + saved 알림, playId 키 없음', async () => {
    api.mockResolvedValue(SUMMARY);
    freeToPending();
    const p = save('내 녹음  ');
    expect(state().phase).toBe('saving');
    await p;
    expect(state().phase).toBe('idle');
    expect(state().pending).toBeNull();
    expect(consumeNotice()).toEqual({ kind: 'saved', recording: SUMMARY });
    const body = api.mock.calls[0][0] as RecordingBody;
    expect(body.title).toBe('내 녹음');
    expect(body.mode).toBe('FREE');
    expect('playId' in body).toBe(false);
    expect(playSync).not.toHaveBeenCalled();
  });

  it('빈 제목이면 기본 제목', async () => {
    api.mockResolvedValue(SUMMARY);
    freeToPending();
    const dt = state().pending!.defaultTitle;
    await save('   ');
    expect((api.mock.calls[0][0] as RecordingBody).title).toBe(dt);
    expect(dt).toMatch(/^자유 연습 · \d+월 \d+일 \d\d:\d\d$/);
  });

  it('pendingSave가 아니면 save는 무시', async () => {
    await save('x');
    expect(api).not.toHaveBeenCalled();
  });

  it('게임: playId가 DONE이면 본문에 playId가 실린다', async () => {
    playSync.mockResolvedValue(done);
    api.mockResolvedValue(SUMMARY);
    toggleArm();
    finishSong(finishArgs());
    await save('');
    const body = api.mock.calls[0][0] as RecordingBody;
    expect(body.playId).toBe('play-1');
    expect(body.title).toBe('곡 · 11월 3일 09:05');
    expect(body.durationMs).toBe(60_000);
    expect(body.clientKey).toBeTruthy();
  });

  it('게임: SKIPPED·FAILED면 playId 키가 없다', async () => {
    for (const st of [skipped, { status: 'FAILED', reason: 'x', retryable: false, attempts: 1, updatedAt: '' }]) {
      resetRecordingForTest();
      api.mockClear();
      playSync.mockResolvedValue(st as never);
      api.mockResolvedValue(SUMMARY);
      toggleArm();
      finishSong(finishArgs());
      await save('');
      expect('playId' in (api.mock.calls[0][0] as RecordingBody)).toBe(false);
    }
  });

  it('503이 소진되면 failed(retryable)이고 모든 호출의 본문이 같다', async () => {
    api.mockRejectedValue(busy());
    freeToPending();
    const p = save('t');
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    await p;
    expect(api).toHaveBeenCalledTimes(4);
    expect(state().phase).toBe('failed');
    expect(state().error).toMatchObject({ retryable: true, kind: 'retry' });
    const first = api.mock.calls[0][0] as RecordingBody;
    for (const c of api.mock.calls) expect(c[0]).toBe(first);
    expect(state().pending?.body).toBe(first);
  });

  it('네트워크 실패 뒤 retry는 같은 본문(같은 clientKey·playId)으로 다시 보낸다', async () => {
    playSync.mockResolvedValue(done);
    api.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'x')).mockResolvedValueOnce(SUMMARY);
    toggleArm();
    finishSong(finishArgs());
    await save('제목');
    expect(state().phase).toBe('failed');
    expect(state().error?.retryable).toBe(true);
    // 재시도 때 playSync 결과가 바뀌어도 본문은 고정
    playSync.mockResolvedValue(skipped);
    await retry();
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[1][0]).toBe(api.mock.calls[0][0]);
    expect((api.mock.calls[1][0] as RecordingBody).playId).toBe('play-1');
    expect(state().phase).toBe('idle');
    expect(consumeNotice()?.kind).toBe('saved');
  });

  it.each([
    ['409', new ApiError(409, 'RECORDING_CONFLICT', 'x'), 'conflict', '저장 중 문제가 생겼어요.'],
    ['400', new ApiError(400, 'RECORDING_INVALID', '제목이 올바르지 않아요'), 'invalid', '제목이 올바르지 않아요'],
    ['404', new ApiError(404, 'RECORDING_PLAY_NOT_FOUND', '플레이를 찾을 수 없어요'), 'invalid', '플레이를 찾을 수 없어요'],
    ['413 쿼터', new ApiError(413, 'RECORDING_QUOTA_EXCEEDED', 'x'), 'quota', '녹음 보관함이 가득 찼어요(200개).'],
    ['413 코드 없음', new ApiError(413, 'HTTP_ERROR', 'HTTP 413'), 'tooLarge', '녹음이 너무 길어 저장하지 못했어요.'],
  ])('%s는 재전송 없이 failed(재시도 불가)', async (_n, err, kind, message) => {
    api.mockRejectedValue(err);
    freeToPending();
    await save('t');
    expect(api).toHaveBeenCalledTimes(1);
    expect(state().phase).toBe('failed');
    expect(state().error).toEqual({ message, retryable: false, kind });
    // 재시도 불가면 retry도 무시
    await retry();
    expect(api).toHaveBeenCalledTimes(1);
    expect(state().phase).toBe('failed');
  });

  it('failed에서 discard하면 idle', async () => {
    api.mockRejectedValue(new ApiError(0, 'NETWORK', 'x'));
    freeToPending();
    await save('t');
    discard();
    expect(state().phase).toBe('idle');
    expect(state().pending).toBeNull();
    expect(state().error).toBeNull();
  });

  it('pendingSave에서 discard하면 idle', () => {
    freeToPending();
    discard();
    expect(state().phase).toBe('idle');
    expect(state().pending).toBeNull();
  });

  it('저장 중 discard하면 응답이 와도 알림·상태가 바뀌지 않는다', async () => {
    let resolve!: (v: RecordingSummary) => void;
    api.mockReturnValue(new Promise((r) => (resolve = r)));
    freeToPending();
    const p = save('t');
    await Promise.resolve();
    discard();
    resolve(SUMMARY);
    await p;
    expect(state().phase).toBe('idle');
    expect(consumeNotice()).toBeNull();
  });

  it('idle·armed에서 discard는 무시', () => {
    toggleArm();
    discard();
    expect(state().phase).toBe('armed');
  });
});

describe('페달만 친 자유 녹음 (PLAY-002)', () => {
  // 인수 조건: 페달 타격이 녹음에 들어가고 stickId 키가 없다. 페달만이어도 STICK
  it('stickId null 센서 타격만 있어도 hasSensor이고 저장 본문은 STICK, stickId 키가 없다', async () => {
    api.mockResolvedValue(SUMMARY);
    startFree();
    bus.__emit(hit({ source: 'webserial' as never, stickId: null, foot: 3, pad: 'KICK' }));
    stopFree('user');
    expect(state().pending?.hasSensor).toBe(true);
    expect('stickId' in state().pending!.hits[0]).toBe(false);
    await save('페달');
    const body = api.mock.calls[0][0] as RecordingBody;
    expect(body.inputSource).toBe('STICK');
    expect(body.hits.every((h) => !('stickId' in h))).toBe(true);
  });

  it('키보드 타격만이면 KEYBOARD', async () => {
    api.mockResolvedValue(SUMMARY);
    freeToPending();
    await save('키보드');
    expect((api.mock.calls[0][0] as RecordingBody).inputSource).toBe('KEYBOARD');
  });
});
