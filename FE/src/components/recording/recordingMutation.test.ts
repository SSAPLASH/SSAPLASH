import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/error';
import { classifyMutationError, runWithRetry } from './recordingMutation';

const busy = (retryAfterMs: number | null = null) => new ApiError(503, 'RECORDING_BUSY', '잠시 후 다시 시도해 주세요', { retryAfterMs });

describe('runWithRetry', () => {
  it('성공하면 한 번만 호출하고 기다리지 않는다', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(runWithRetry(fn, sleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('503이면 1초 뒤 1회 재시도해 성공한다', async () => {
    const fn = vi.fn().mockRejectedValueOnce(busy()).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(runWithRetry(fn, sleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('retryAfterMs가 있으면 그 시간을 기다린다', async () => {
    const fn = vi.fn().mockRejectedValueOnce(busy(3000)).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await runWithRetry(fn, sleep);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('재시도도 503이면 두 번째 오류를 던지고 더 시도하지 않는다', async () => {
    const second = busy();
    const fn = vi.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(second);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(runWithRetry(fn, sleep)).rejects.toBe(second);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('503이 아닌 오류는 재시도하지 않는다', async () => {
    const err = new ApiError(404, 'RECORDING_NOT_FOUND', '없음');
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(runWithRetry(fn, sleep)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('classifyMutationError', () => {
  it('404 RECORDING_NOT_FOUND는 missing', () => {
    expect(classifyMutationError(new ApiError(404, 'RECORDING_NOT_FOUND', '없어요')).kind).toBe('missing');
  });

  it('400 RECORDING_INVALID는 invalid이고 detail을 담는다', () => {
    expect(classifyMutationError(new ApiError(400, 'RECORDING_INVALID', '제목은 100자까지예요'))).toEqual({
      kind: 'invalid',
      detail: '제목은 100자까지예요',
    });
  });

  it('그 밖의 ApiError·일반 오류는 other', () => {
    expect(classifyMutationError(new ApiError(500, 'HTTP_ERROR', 'HTTP 500'))).toEqual({ kind: 'other', detail: 'HTTP 500' });
    expect(classifyMutationError(new ApiError(404, 'OTHER', '다른 404')).kind).toBe('other');
    expect(classifyMutationError(new Error('x'))).toEqual({ kind: 'other', detail: '' });
  });
});
