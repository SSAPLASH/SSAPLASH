import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllPlays } from './plays';
import { apiFetch } from './http';

vi.mock('./http', () => ({ apiFetch: vi.fn() }));

beforeEach(() => vi.mocked(apiFetch).mockReset());

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
