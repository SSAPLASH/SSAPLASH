import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/http';
import { createQueryClient, shouldRetry } from './queryClient';

const abort = () => new DOMException('aborted', 'AbortError');

describe('shouldRetry (설계 TECH-350 3절)', () => {
  it('네트워크 오류·5xx는 1회만 재시도한다', () => {
    expect(shouldRetry(0, new ApiError(0, 'NETWORK', '연결 실패'))).toBe(true);
    expect(shouldRetry(0, new ApiError(503, 'HTTP_ERROR', '점검'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'HTTP_ERROR', '점검'))).toBe(false);
  });
  it('4xx는 재시도하지 않는다', () => {
    for (const status of [400, 401, 403, 404, 409, 429]) expect(shouldRetry(0, new ApiError(status, 'X', 'x'))).toBe(false);
  });
  it('취소(직접 AbortError·apiFetch가 감싼 NETWORK)는 재시도하지 않는다', () => {
    expect(shouldRetry(0, abort())).toBe(false);
    expect(shouldRetry(0, new ApiError(0, 'NETWORK', '연결 실패', { cause: abort() }))).toBe(false);
  });
  it('ApiError가 아닌 오류는 재시도하지 않는다', () => {
    expect(shouldRetry(0, new Error('변환 실패'))).toBe(false);
  });
});

describe('createQueryClient 기본값', () => {
  it('신선 30초·보관 5분·포커스 재조회 끔·변경 재시도 0', () => {
    const d = createQueryClient().getDefaultOptions();
    expect(d.queries?.staleTime).toBe(30_000);
    expect(d.queries?.gcTime).toBe(300_000);
    expect(d.queries?.refetchOnWindowFocus).toBe(false);
    expect(d.mutations?.retry).toBe(0);
  });
});
