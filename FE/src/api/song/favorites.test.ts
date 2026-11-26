import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/api/http';
import { addFavoriteSong, listFavoriteSongIds, removeFavoriteSong } from './favorites';

vi.mock('@/api/http', () => ({ apiFetch: vi.fn() }));

beforeEach(() => vi.mocked(apiFetch).mockReset());

describe('곡 즐겨찾기 API', () => {
  it('목록은 songIds를 숫자로 바꾸고 모르는 값·중복을 버린다', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ songIds: [3, '5', 3, null, 'x', 1.5] });
    await expect(listFavoriteSongIds()).resolves.toEqual([3, 5]);
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/songs/favorites', { signal: undefined });
  });

  it('songIds가 없으면 빈 목록이다', async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    await expect(listFavoriteSongIds()).resolves.toEqual([]);
  });

  it('추가는 PUT, 해제는 DELETE를 그 곡 주소로 보낸다', async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);
    await addFavoriteSong(12);
    await removeFavoriteSong(12);
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/v1/songs/12/favorite', { method: 'PUT' });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/v1/songs/12/favorite', { method: 'DELETE' });
  });
});
