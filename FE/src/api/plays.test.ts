import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBestRecords, listAllPlays } from './plays';
import { apiFetch } from './http';

vi.mock('./http', () => ({ apiFetch: vi.fn() }));

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

describe('listAllPlays', () => {
  it('모든 페이지를 읽고 페이지 경계에서 중복된 playId를 제거한다', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ items: [{ playId: 'a' }, { playId: 'b' }], hasNext: true })
      .mockResolvedValueOnce({ items: [{ playId: 'b' }, { playId: 'c' }], hasNext: false });
    const signal = new AbortController().signal;
    expect((await listAllPlays(signal)).map((p) => p.playId)).toEqual(['a', 'b', 'c']);
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/v1/plays?page=0&size=100', { signal });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/v1/plays?page=1&size=100', { signal });
  });

  it('실패나 중단은 빈 목록으로 취급하지 않는다', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('network'));
    await expect(listAllPlays(new AbortController().signal)).rejects.toThrow('network');
    const controller = new AbortController();
    controller.abort();
    vi.mocked(apiFetch).mockResolvedValueOnce({ items: [], hasNext: false });
    await expect(listAllPlays(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
