import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBestRecords, listPlays } from './plays';
import { apiFetch } from '@/api/http';

vi.mock('@/api/http', () => ({ apiFetch: vi.fn() }));

beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

describe('getBestRecords', () => {
  it('곡 ID와 취소 신호를 전송하고 서버 백분율을 그대로 반환한다', async () => {
    const response = { items: [{ songId: 1, bestAccuracy: 98.76 }] };
    vi.mocked(apiFetch).mockResolvedValue(response);
    const signal = new AbortController().signal;
    expect(await getBestRecords([1, 2], signal)).toBe(response);
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/plays/best-records?songIds=1,2', { signal });
  });
  it('유효하지 않은 요청은 보내지 않고 네트워크 오류를 전파한다', async () => {
    const signal = new AbortController().signal;
    for (const ids of [[], [-1], [0], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array(101).fill(1)]) {
      await expect(getBestRecords(ids, signal)).rejects.toThrow();
    }
    expect(apiFetch).not.toHaveBeenCalled();
    vi.mocked(apiFetch).mockRejectedValue(new Error('network'));
    await expect(getBestRecords([1], signal)).rejects.toThrow('network');
  });
});

describe('listPlays', () => {
  const page = { items: [{ playId: 'a' }], page: 0, size: 20, totalElements: 1, totalPages: 1, hasNext: false };

  it('조건을 쿼리로 보낸다(검색어는 앞뒤 공백 제거)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(page);
    const signal = new AbortController().signal;
    expect(await listPlays({ q: '  별빛 ', from: '2026-11-06', to: '2026-11-12', mode: 'SHEET', sort: 'OLDEST', page: 2, size: 20 }, signal)).toBe(page);
    const [url, init] = vi.mocked(apiFetch).mock.calls[0];
    const parsed = new URL(url, 'http://x');
    expect(parsed.pathname).toBe('/api/v1/plays');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ q: '별빛', from: '2026-11-06', to: '2026-11-12', mode: 'SHEET', sort: 'OLDEST', page: '2', size: '20' });
    expect(init).toEqual({ signal });
  });

  it('값이 없는 조건은 넣지 않는다', async () => {
    vi.mocked(apiFetch).mockResolvedValue(page);
    await listPlays({ q: '   ', page: 0, size: 20 });
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe('/api/v1/plays?page=0&size=20');
    await listPlays();
    expect(vi.mocked(apiFetch).mock.calls[1][0]).toBe('/api/v1/plays');
  });

  it('실패는 빈 목록으로 취급하지 않는다', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('network'));
    await expect(listPlays({ page: 0 })).rejects.toThrow('network');
  });
});
