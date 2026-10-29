import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from './auth';
import { deleteSong, deleteSongCover, updateSongMeta, uploadMidi, uploadSongCover } from './songs';

const body = { id: 7, title: '곡', artist: '가수', source: 'MIDI', status: 'READY', hasAccompaniment: false, charts: [] };

function stub() {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 201, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('uploadMidi', () => {
  it('title·artist·file을 한 번씩 multipart로 보내고 Idempotency-Key는 없다', async () => {
    const fn = stub();
    const file = new File(['abc'], 'a.mid');
    const song = await uploadMidi({ file, title: '곡', artist: ' 가수 ' });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/songs/midi');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeNull();
    const form = init?.body as FormData;
    expect(form.getAll('title')).toEqual(['곡']);
    expect(form.getAll('artist')).toEqual(['가수']);
    expect(form.getAll('file')).toHaveLength(1);
    expect(song.id).toBe(7);
    expect(song.source).toBe('MIDI');
  });

  it('artist가 비면 보내지 않는다', async () => {
    const fn = stub();
    await uploadMidi({ file: new File(['abc'], 'a.mid'), title: '곡', artist: '  ' });
    const form = fn.mock.calls[0][1]?.body as FormData;
    expect(form.has('artist')).toBe(false);
  });
});

describe('곡 편집 API', () => {
  it('updateSongMeta: PATCH /songs/{id}에 바뀐 필드만 JSON으로 보낸다', async () => {
    const fn = stub();
    const song = await updateSongMeta(7, { artist: '' });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/songs/7');
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ artist: '' });
    expect(song.id).toBe(7);
  });

  it('uploadSongCover: PUT /songs/{id}/cover multipart 필드 file', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ coverUrl: 'https://x/c.jpg' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fn);
    const res = await uploadSongCover(7, new Blob(['x'], { type: 'image/jpeg' }));
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/songs/7/cover');
    expect(init.method).toBe('PUT');
    const form = init.body as FormData;
    expect(form.getAll('file')).toHaveLength(1);
    expect(res.coverUrl).toBe('https://x/c.jpg');
  });

  it('deleteSongCover: DELETE /songs/{id}/cover', async () => {
    const fn = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fn);
    await deleteSongCover(7);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/songs/7/cover');
    expect(init.method).toBe('DELETE');
  });

  it('deleteSong: DELETE /songs/{id}', async () => {
    const fn = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fn);
    await deleteSong(7);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/songs/7');
    expect(init.method).toBe('DELETE');
  });
});
