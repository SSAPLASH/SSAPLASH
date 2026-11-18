import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/error';
import type { RecordingBody, RecordingSummary } from '@/domain/play/recording';

vi.mock('@/api/play/recordings', () => ({ saveRecording: vi.fn() }));
vi.mock('./playSync', () => ({ startPlaySync: vi.fn() }));

import { saveRecording } from '@/api/play/recordings';
import { startPlaySync } from './playSync';
import { describeRecordingError, resolvePlayId, uploadRecording } from './recordingSync';

const save = vi.mocked(saveRecording);
const sync = vi.mocked(startPlaySync);

const BODY: RecordingBody = {
  schemaVersion: 1,
  clientKey: 'ck-1',
  title: '제목',
  mode: 'FREE',
  inputSource: 'KEYBOARD',
  startedAt: '2026-11-03T00:00:00.000Z',
  durationMs: 1000,
  hits: [{ tMs: 10, pad: 'SNARE', velocity: 100 }],
};
const SUMMARY = { id: 1 } as RecordingSummary;

const busy = (retryAfterMs?: number) => new ApiError(503, 'RECORDING_BUSY', '바빠요', { retryAfterMs });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('resolvePlayId', () => {
  const st = (status: string) => ({ status, reason: null, retryable: false, attempts: 1, updatedAt: '' }) as never;

  it('DONE이면 playId를 돌려준다', async () => {
    sync.mockResolvedValue(st('DONE'));
    expect(await resolvePlayId('p1')).toBe('p1');
  });

  it.each(['SKIPPED', 'FAILED'])('%s이면 undefined', async (s) => {
    sync.mockResolvedValue(st(s));
    expect(await resolvePlayId('p1')).toBeUndefined();
  });

  it('null·예외도 undefined', async () => {
    sync.mockResolvedValueOnce(null);
    expect(await resolvePlayId('p1')).toBeUndefined();
    sync.mockRejectedValueOnce(new Error('x'));
    expect(await resolvePlayId('p1')).toBeUndefined();
  });

  it('진행 중인 업로드가 끝나길 기다린다', async () => {
    let done!: (v: never) => void;
    sync.mockReturnValue(new Promise((r) => (done = r as typeof done)));
    let result: string | undefined = 'pending';
    const p = resolvePlayId('p1').then((v) => (result = v));
    await Promise.resolve();
    expect(result).toBe('pending');
    done(st('DONE'));
    await p;
    expect(result).toBe('p1');
  });
});

describe('uploadRecording', () => {
  it('성공하면 그대로 돌려준다', async () => {
    save.mockResolvedValue(SUMMARY);
    expect(await uploadRecording(BODY)).toBe(SUMMARY);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('503은 같은 본문으로 1·2·4초 간격으로 재시도한다', async () => {
    save.mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValueOnce(SUMMARY);
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await uploadRecording(BODY, { sleep })).toBe(SUMMARY);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
    expect(save).toHaveBeenCalledTimes(4);
    for (const c of save.mock.calls) expect(c[0]).toBe(BODY);
  });

  it('retryAfterMs가 있으면 그 값을 기다린다', async () => {
    save.mockRejectedValueOnce(busy(7000)).mockResolvedValueOnce(SUMMARY);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await uploadRecording(BODY, { sleep });
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('503이 계속되면 3회 재시도 뒤(총 4번) 오류를 던진다', async () => {
    save.mockRejectedValue(busy());
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(uploadRecording(BODY, { sleep })).rejects.toMatchObject({ status: 503 });
    expect(save).toHaveBeenCalledTimes(4);
  });

  it.each([400, 404, 409, 413, 500])('%i는 재시도하지 않는다', async (status) => {
    save.mockRejectedValue(new ApiError(status, 'X', 'x'));
    const sleep = vi.fn();
    await expect(uploadRecording(BODY, { sleep })).rejects.toBeInstanceOf(ApiError);
    expect(save).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('네트워크 실패도 자동 재시도하지 않는다', async () => {
    save.mockRejectedValue(new ApiError(0, 'NETWORK', '연결 실패'));
    await expect(uploadRecording(BODY, { sleep: vi.fn() })).rejects.toBeInstanceOf(ApiError);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('describeRecordingError', () => {
  it('네트워크·5xx·503은 재시도 가능', () => {
    for (const s of [0, 500, 502, 503]) {
      const r = describeRecordingError(new ApiError(s, 'X', 'x'));
      expect(r).toMatchObject({ retryable: true, kind: 'retry' });
      expect(r.message).toContain('연결이 불안정');
    }
  });

  it('ApiError가 아니면 네트워크와 같다', () => {
    expect(describeRecordingError(new TypeError('x'))).toMatchObject({ retryable: true, kind: 'retry' });
  });

  it('401은 로그인 안내, 재시도 가능', () => {
    const r = describeRecordingError(new ApiError(401, 'UNAUTHORIZED', 'x'));
    expect(r).toMatchObject({ retryable: true, kind: 'auth' });
    expect(r.message).toContain('로그인');
  });

  it('409는 일반 문구 + 콘솔 경고, 재시도 불가', () => {
    const r = describeRecordingError(new ApiError(409, 'RECORDING_CONFLICT', 'x'));
    expect(r).toEqual({ message: '저장 중 문제가 생겼어요.', retryable: false, kind: 'conflict' });
    expect(console.warn).toHaveBeenCalled();
  });

  it('413 쿼터 초과', () => {
    const r = describeRecordingError(new ApiError(413, 'RECORDING_QUOTA_EXCEEDED', 'x'));
    expect(r).toMatchObject({ retryable: false, kind: 'quota' });
    expect(r.message).toContain('가득 찼어요(200개)');
  });

  it('413 코드 없음(Nginx)·RECORDING_TOO_LARGE는 너무 김', () => {
    for (const code of ['HTTP_ERROR', 'RECORDING_TOO_LARGE']) {
      const r = describeRecordingError(new ApiError(413, code, 'HTTP 413'));
      expect(r).toMatchObject({ retryable: false, kind: 'tooLarge' });
      expect(r.message).toContain('너무 길어');
    }
  });

  it('400·404는 detail을 보이고 재시도 불가', () => {
    for (const s of [400, 404]) {
      expect(describeRecordingError(new ApiError(s, 'RECORDING_INVALID', '제목은 100자 이하여야 해요'))).toEqual({
        message: '제목은 100자 이하여야 해요',
        retryable: false,
        kind: 'invalid',
      });
    }
  });

  it('400인데 detail이 일반 HTTP 문구면 일반 문구', () => {
    const r = describeRecordingError(new ApiError(400, 'HTTP_ERROR', 'HTTP 400'));
    expect(r.message).toBe('녹음을 저장하지 못했어요.');
  });
});

describe('uploadRecording 캐시 무효화 (설계 TECH-351)', () => {
  it('저장에 성공하면 녹음 목록 캐시를 무효화하고, 실패하면 하지 않는다', async () => {
    const { queryClient } = await import('./queryClient');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    save.mockResolvedValueOnce(SUMMARY);
    await uploadRecording(BODY);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['recordings'] });
    spy.mockClear();
    save.mockRejectedValueOnce(new ApiError(400, 'BAD', 'x'));
    await expect(uploadRecording(BODY)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
