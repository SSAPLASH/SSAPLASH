import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { listAllAdminSongs, registerAdminSong, uploadAccompaniment } from './adminSongs';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const detail = { id: 9, title: '곡', artist: null, license: 'x', status: 'READY', hasAccompaniment: false, published: true, difficulties: [] };

beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('listAllAdminSongs', () => {
  it('hasNext가 거짓이 될 때까지 100개씩 읽어 하나로 합친다', async () => {
    const fn = vi.fn(async (url: string) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      return json(200, { items: [{ id: page * 10 + 1, title: `곡${page}` }], hasNext: page < 2 });
    });
    vi.stubGlobal('fetch', fn);
    const songs = await listAllAdminSongs();
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn.mock.calls[0][0]).toBe('/api/v1/admin/songs?page=0&size=100');
    expect(songs.map((s) => s.id)).toEqual([1, 11, 21]);
  });
});

describe('registerAdminSong', () => {
  it('필드를 다듬어 multipart로 보내고 offsetMs·published는 필요할 때만 보낸다', async () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => json(201, detail));
    vi.stubGlobal('fetch', fn);
    const file = new File(['abc'], 'a.mid');
    const song = await registerAdminSong({ file, title: ' 곡 ', artist: '  ', license: ' x ', offsetMs: ' 1226 ', published: true, accompaniment: null });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/admin/songs/midi');
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(form.getAll('title')).toEqual(['곡']);
    expect(form.has('artist')).toBe(false);
    expect(form.getAll('license')).toEqual(['x']);
    expect(form.getAll('offsetMs')).toEqual(['1226']);
    expect(form.has('published')).toBe(false);
    expect(form.getAll('file')).toHaveLength(1);
    expect(song.id).toBe(9);
  });

  it('offsetMs가 비면 보내지 않고, 비공개면 published=false', async () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => json(201, detail));
    vi.stubGlobal('fetch', fn);
    await registerAdminSong({ file: new File(['a'], 'a.mid'), title: '곡', artist: '가수', license: 'x', offsetMs: '', published: false, accompaniment: null });
    const form = fn.mock.calls[0][1]?.body as FormData;
    expect(form.has('offsetMs')).toBe(false);
    expect(form.getAll('published')).toEqual(['false']);
    expect(form.getAll('artist')).toEqual(['가수']);
  });
});

describe('uploadAccompaniment', () => {
  it('PUT /{id}/accompaniment에 file 하나만 보낸다', async () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { accompanimentUrl: 'u', expiresAt: 't' }));
    vi.stubGlobal('fetch', fn);
    await uploadAccompaniment(9, new File(['x'], 'a.mp3'));
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/admin/songs/9/accompaniment');
    expect(init?.method).toBe('PUT');
    const form = init?.body as FormData;
    expect([...form.keys()]).toEqual(['file']);
  });

  it('서버 오류는 코드가 있는 ApiError로 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(422, { code: 'ACCOMPANIMENT_UNSUPPORTED', detail: 'x' })));
    await expect(uploadAccompaniment(9, new File(['x'], 'a.mp3'))).rejects.toMatchObject({ status: 422, code: 'ACCOMPANIMENT_UNSUPPORTED' });
  });
});
