import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import type { AccompanimentStatus, SongSummary } from '@/domain/song/songCatalog';
import { ACC_POLL_INTERVAL_MS, ACC_POLL_MAX_TRIES, AccompanimentPoller } from './accompanimentPoller';

const song = (id: number, accompanimentStatus: AccompanimentStatus): SongSummary => ({
  id,
  title: '곡',
  artist: '',
  source: 'MIDI',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 60000,
  hasAccompaniment: accompanimentStatus === 'READY',
  accompanimentStatus,
  songLevel: null,
  difficulties: [],
  createdAt: '2026-11-03T00:00:00Z',
  coverUrl: null,
  sheetId: null,
});

/** 한 회차의 타이머를 넘기고 조회 Promise들을 흘려 보낸다 */
async function tick(ms = ACC_POLL_INTERVAL_MS) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AccompanimentPoller', () => {
  it('3초 뒤 대상 곡을 한 곡씩 읽어 넘기고, 대상이 남으면 다음 회차를 건다', async () => {
    const fetchSong = vi.fn(async (id: number) => song(id, 'GENERATING'));
    const onSong = vi.fn();
    const p = new AccompanimentPoller({ fetchSong, onSong });
    p.update([1, 2], true);

    await tick(ACC_POLL_INTERVAL_MS - 1);
    expect(fetchSong).not.toHaveBeenCalled();
    await tick(1);
    expect(fetchSong.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    expect(onSong).toHaveBeenCalledTimes(2);
    expect(p.triesUsed).toBe(1);

    await tick();
    expect(fetchSong).toHaveBeenCalledTimes(4);
    expect(p.triesUsed).toBe(2);
    p.dispose();
  });

  it('대상이 비면 더 읽지 않는다', async () => {
    const fetchSong = vi.fn(async (id: number) => song(id, 'READY'));
    const p = new AccompanimentPoller({ fetchSong, onSong: () => {} });
    p.update([1], true);
    await tick();
    // 화면이 READY를 반영해 대상이 빈 목록으로 다시 알린다
    p.update([], true);
    await tick();
    await tick();
    expect(fetchSong).toHaveBeenCalledTimes(1);
  });

  it('최대 20회에서 멈춘다', async () => {
    const fetchSong = vi.fn(async (id: number) => song(id, 'GENERATING'));
    const p = new AccompanimentPoller({ fetchSong, onSong: () => {} });
    p.update([1], true);
    for (let i = 0; i < ACC_POLL_MAX_TRIES + 3; i++) await tick();
    expect(fetchSong).toHaveBeenCalledTimes(ACC_POLL_MAX_TRIES);
    expect(p.triesUsed).toBe(ACC_POLL_MAX_TRIES);
    // 상한 뒤에는 다시 알려도 걸지 않는다
    p.update([1], true);
    await tick();
    expect(fetchSong).toHaveBeenCalledTimes(ACC_POLL_MAX_TRIES);
  });

  it('최대 횟수 뒤 재시도한 곡은 새 회차로 다시 확인한다', async () => {
    const fetchSong = vi.fn(async (id: number) => song(id, 'GENERATING'));
    const p = new AccompanimentPoller({ fetchSong, onSong: () => {}, maxTries: 1 });
    p.update([1], true);
    await tick();
    await tick();
    expect(fetchSong).toHaveBeenCalledTimes(1);
    p.restart(2);
    p.update([1, 2], true);
    await tick();
    expect(fetchSong.mock.calls.map((c) => c[0])).toEqual([1, 1, 2]);
    p.dispose();
  });

  it('비활성(탭 숨김)이면 멈추고, 다시 활성이면 남은 횟수로 이어간다', async () => {
    const fetchSong = vi.fn(async (id: number) => song(id, 'GENERATING'));
    const p = new AccompanimentPoller({ fetchSong, onSong: () => {} });
    p.update([1], true);
    await tick();
    expect(p.triesUsed).toBe(1);

    p.update([1], false);
    await tick();
    await tick();
    expect(fetchSong).toHaveBeenCalledTimes(1);

    p.update([1], true);
    await tick();
    expect(fetchSong).toHaveBeenCalledTimes(2);
    expect(p.triesUsed).toBe(2);
    p.dispose();
  });

  it('dispose(화면 이탈)하면 대기 중 회차와 진행 중 조회를 멈춘다', async () => {
    let signal: AbortSignal | null = null;
    const fetchSong = vi.fn(
      (_id: number, s: AbortSignal) =>
        new Promise<SongSummary>((_resolve, reject) => {
          signal = s;
          s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const onSong = vi.fn();
    const p = new AccompanimentPoller({ fetchSong, onSong });
    p.update([1, 2], true);
    await tick();
    expect(fetchSong).toHaveBeenCalledTimes(1);
    p.dispose();
    await tick();
    expect(signal!.aborted).toBe(true);
    expect(fetchSong).toHaveBeenCalledTimes(1);
    expect(onSong).not.toHaveBeenCalled();
    expect(p.triesUsed).toBe(0);
  });

  it('404 곡은 대상에서 빼고, 다른 실패는 그 회차만 건너뛴다', async () => {
    const fetchSong = vi.fn(async (id: number) => {
      if (id === 1) throw new ApiError(404, 'SONG_NOT_FOUND', '곡을 찾을 수 없습니다.');
      if (id === 2) throw new Error('network');
      return song(id, 'GENERATING');
    });
    const onSong = vi.fn();
    const p = new AccompanimentPoller({ fetchSong, onSong });
    p.update([1, 2, 3], true);
    await tick();
    expect(onSong).toHaveBeenCalledTimes(1);

    await tick();
    expect(fetchSong.mock.calls.slice(3).map((c) => c[0])).toEqual([2, 3]);
    // 화면이 404 곡을 다시 알려도 읽지 않는다
    p.update([1, 2, 3], true);
    await tick();
    expect(fetchSong.mock.calls.slice(5).map((c) => c[0])).toEqual([2, 3]);
    p.dispose();
  });

  it('대기 중에 대상이 바뀌면 그 회차에 새 대상을 읽는다', async () => {
    const fetchSong = vi.fn(async (id: number) => song(id, 'GENERATING'));
    const p = new AccompanimentPoller({ fetchSong, onSong: () => {} });
    p.update([1], true);
    await tick(1000);
    p.update([1, 2], true);
    await tick(ACC_POLL_INTERVAL_MS - 1000);
    expect(fetchSong.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    p.dispose();
  });
});
