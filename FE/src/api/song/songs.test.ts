import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { checkSongAvailability, deleteSong, deleteSongCover, getSongAccompaniment, retryMidiAccompaniment, listAllSongs, listSongs, SONG_LIST_MAX_PAGES, updateSongMeta, uploadMidi, uploadMusicXml, uploadSongCover } from './songs';

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
    // 응답에 반주 상태가 없으면 hasAccompaniment(false)로 NONE
    expect(song.accompanimentStatus).toBe('NONE');
  });

  it('artist가 비면 보내지 않는다', async () => {
    const fn = stub();
    await uploadMidi({ file: new File(['abc'], 'a.mid'), title: '곡', artist: '  ' });
    const form = fn.mock.calls[0][1]?.body as FormData;
    expect(form.has('artist')).toBe(false);
  });
});

describe('uploadMusicXml', () => {
  it('MIDI와 같은 multipart를 /api/v1/songs/musicxml로 보낸다(293)', async () => {
    const fn = stub();
    const song = await uploadMusicXml({ file: new File(['<score-partwise/>'], 's.musicxml'), title: ' 악보 곡 ', artist: '' });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/songs/musicxml');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeNull();
    const form = init?.body as FormData;
    expect(form.getAll('title')).toEqual(['악보 곡']);
    expect(form.has('artist')).toBe(false);
    expect(form.getAll('file')).toHaveLength(1);
    expect(song.id).toBe(7);
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

describe('checkSongAvailability', () => {
  const respond = (status: number, json: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } })),
    );

  it('곡 상세가 오면 available', async () => {
    respond(200, body);
    await expect(checkSongAvailability(7)).resolves.toBe('available');
  });

  it('404 SONG_NOT_FOUND면 deleted', async () => {
    respond(404, { status: 404, code: 'SONG_NOT_FOUND', detail: '곡을 찾을 수 없습니다.' });
    await expect(checkSongAvailability(7)).resolves.toBe('deleted');
  });

  it('5xx·네트워크 실패는 unknown', async () => {
    respond(503, { status: 503, code: 'UNAVAILABLE', detail: '점검 중' });
    await expect(checkSongAvailability(7)).resolves.toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fail'))));
    await expect(checkSongAvailability(7)).resolves.toBe('unknown');
  });

  it('취소되면 판정하지 않고 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(checkSongAvailability(7, ctrl.signal)).rejects.toBeTruthy();
  });
});

describe('listSongs 목록 조건', () => {
  function stubList() {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ items: [{ ...body, songLevel: 'INTERMEDIATE' }], hasNext: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  const query = (fn: ReturnType<typeof stubList>) => new URL(String(fn.mock.calls[0][0]), 'http://x').searchParams;

  it('조건이 없으면 songLevel·playableOnly를 보내지 않는다(내 곡)', async () => {
    const fn = stubList();
    await listSongs({ source: 'MINE' });
    expect(query(fn).has('songLevel')).toBe(false);
    expect(query(fn).has('playableOnly')).toBe(false);
  });

  it('난이도와 플레이 후보 조건을 쿼리로 보낸다', async () => {
    const fn = stubList();
    const page = await listSongs({ source: 'BUILTIN', songLevel: 'ADVANCED', playableOnly: true, size: 50 });
    expect(query(fn).get('songLevel')).toBe('ADVANCED');
    expect(query(fn).get('playableOnly')).toBe('true');
    expect(query(fn).get('source')).toBe('BUILTIN');
    expect(page.items[0].songLevel).toBe('INTERMEDIATE');
  });

  it('playableOnly=false는 생략한다', async () => {
    const fn = stubList();
    await listSongs({ source: 'MINE', playableOnly: false });
    expect(query(fn).has('playableOnly')).toBe(false);
  });
});

describe('listSongs withAccompaniment', () => {
  const stubOnce = () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ items: [], hasNext: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  it('true면 withAccompaniment=true를 보낸다', async () => {
    const fn = stubOnce();
    await listSongs({ source: 'BUILTIN', withAccompaniment: true });
    expect(new URL(String(fn.mock.calls[0][0]), 'http://x').searchParams.get('withAccompaniment')).toBe('true');
  });

  it('false·생략이면 보내지 않는다', async () => {
    const fn = stubOnce();
    await listSongs({ source: 'MINE', withAccompaniment: false });
    await listSongs({ source: 'MINE' });
    for (const c of fn.mock.calls) expect(new URL(String(c[0]), 'http://x').searchParams.has('withAccompaniment')).toBe(false);
  });
});

describe('getSongAccompaniment', () => {
  const stubJson = (json: unknown, status = 200) => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  it('곡 단위 URL을 부르고 응답을 url·expiresAt으로 바꾼다', async () => {
    const fn = stubJson({ accompanimentUrl: 'https://s/a.mp3', expiresAt: '2026-11-07T00:00:00Z' });
    const r = await getSongAccompaniment(7);
    expect(fn.mock.calls[0][0]).toBe('/api/v1/songs/7/accompaniment');
    expect(r).toEqual({ url: 'https://s/a.mp3', expiresAt: '2026-11-07T00:00:00Z' });
  });

  it('반주가 없으면 둘 다 null', async () => {
    stubJson({ accompanimentUrl: null, expiresAt: null });
    expect(await getSongAccompaniment(7)).toEqual({ url: null, expiresAt: null });
  });

  it('404는 ApiError로 던진다', async () => {
    stubJson({ code: 'SONG_NOT_FOUND', detail: '없음' }, 404);
    await expect(getSongAccompaniment(7)).rejects.toMatchObject({ status: 404 });
  });
});

describe('listAllSongs 전체 페이지 (Jira 363)', () => {
  function stubPages(lastPage: number) {
    const fn = vi.fn(async (url: string, _init?: RequestInit) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      return new Response(JSON.stringify({ items: [{ ...body, id: page + 1 }], hasNext: page < lastPage }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  const qs = (fn: ReturnType<typeof stubPages>, i: number) => new URL(String(fn.mock.calls[i][0]), 'http://x').searchParams;

  it('hasNext가 거짓이 될 때까지 100곡씩 읽어 순서대로 합치고, 조건은 모든 페이지에 싣는다', async () => {
    const fn = stubPages(2);
    const items = await listAllSongs({ source: 'BUILTIN', q: '드럼', songLevel: 'BEGINNER', playableOnly: true });
    expect(items.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(fn).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      expect(qs(fn, i).get('page')).toBe(String(i));
      expect(qs(fn, i).get('size')).toBe('100');
      expect(qs(fn, i).get('q')).toBe('드럼');
      expect(qs(fn, i).get('songLevel')).toBe('BEGINNER');
      expect(qs(fn, i).get('playableOnly')).toBe('true');
    }
  });

  it('hasNext가 계속 참이어도 상한 쪽수에서 멈춘다', async () => {
    const fn = stubPages(Number.POSITIVE_INFINITY);
    const items = await listAllSongs({ source: 'MINE' });
    expect(fn).toHaveBeenCalledTimes(SONG_LIST_MAX_PAGES);
    expect(items).toHaveLength(SONG_LIST_MAX_PAGES);
  });

  it('isStale이 참이면 다음 페이지를 읽지 않는다', async () => {
    const fn = stubPages(5);
    const items = await listAllSongs({ source: 'MINE' }, { isStale: () => true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(items.map((s) => s.id)).toEqual([1]);
  });
});


describe('retryMidiAccompaniment', () => {
  it('본문 없이 Bearer 인증 POST를 보내고 빈 202를 처리한다', async () => {
    const fn = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fn);
    await expect(retryMidiAccompaniment(7)).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/songs/7/accompaniment/retry');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
  });
});
