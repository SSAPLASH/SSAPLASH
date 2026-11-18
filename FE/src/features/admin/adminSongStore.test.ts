import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { ACCOMPANIMENT_PRECHECK_TEXT, ADMIN_DRAFT_TEXT, adminErrorText, type AdminSongDraft } from './adminSong';
import { useAdminSongs } from './adminSongStore';

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}
const problem = (status: number, code: string) => json(status, { status, detail: '오류', code }, 'application/problem+json');

function mockFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const row = (id: number, hasAccompaniment = false) => ({ id, title: `곡${id}`, license: 'x', status: 'READY', hasAccompaniment, published: true, difficulties: [] });

function draft(over: Partial<AdminSongDraft> = {}): AdminSongDraft {
  return { file: new File(['a'], 'a.mid'), title: '곡', artist: '', license: 'x', offsetMs: '', published: true, accompaniment: null, ...over };
}

beforeEach(() => resetForTest('tok'));
afterEach(() => {
  useAdminSongs.getState().resetForTest();
  vi.unstubAllGlobals();
});

describe('adminSongStore.load', () => {
  it('목록을 읽어 ready', async () => {
    mockFetch(() => json(200, { items: [row(1), row(2, true)], hasNext: false }));
    await useAdminSongs.getState().load();
    const s = useAdminSongs.getState();
    expect(s.status).toBe('ready');
    expect(s.songs.map((x) => x.id)).toEqual([1, 2]);
  });

  it('403이면 error와 관리자 문구', async () => {
    mockFetch(() => problem(403, 'FORBIDDEN'));
    await useAdminSongs.getState().load();
    expect(useAdminSongs.getState()).toMatchObject({ status: 'error', loadError: adminErrorText('FORBIDDEN') });
  });
});

describe('adminSongStore.register', () => {
  it('입력이 틀리면 요청하지 않고 사유 문구를 돌려준다', async () => {
    const fn = mockFetch(() => json(201, row(9)));
    const r = await useAdminSongs.getState().register(draft({ license: ' ' }));
    expect(fn).not.toHaveBeenCalled();
    expect(r).toEqual({ result: 'invalid', message: ADMIN_DRAFT_TEXT.LICENSE });
  });

  it('등록 뒤 반주를 이어서 올리고 목록을 다시 읽는다', async () => {
    const fn = mockFetch((url, init) => {
      if (url.endsWith('/midi')) return json(201, row(9));
      if (url.endsWith('/9/accompaniment') && init?.method === 'PUT') return json(200, { accompanimentUrl: 'u', expiresAt: 't' });
      return json(200, { items: [row(9, true)], hasNext: false });
    });
    const r = await useAdminSongs.getState().register(draft({ accompaniment: new File(['x'], 'a.mp3') }));
    expect(r).toEqual({ result: 'done', message: null });
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/admin/songs/midi',
      '/api/v1/admin/songs/9/accompaniment',
      '/api/v1/admin/songs?page=0&size=100',
    ]);
    expect(useAdminSongs.getState().songs[0].hasAccompaniment).toBe(true);
    expect(useAdminSongs.getState().saving).toBe(false);
  });

  it('곡은 등록됐는데 반주가 실패하면 partial', async () => {
    mockFetch((url) => {
      if (url.endsWith('/midi')) return json(201, row(9));
      if (url.endsWith('/accompaniment')) return problem(422, 'ACCOMPANIMENT_UNSUPPORTED');
      return json(200, { items: [row(9)], hasNext: false });
    });
    const r = await useAdminSongs.getState().register(draft({ accompaniment: new File(['x'], 'a.mp3') }));
    expect(r.result).toBe('partial');
    expect(r.message).toContain(adminErrorText('ACCOMPANIMENT_UNSUPPORTED'));
  });

  it('등록 중 네트워크 오류면 결과 미확인 문구와 함께 목록을 다시 읽는다', async () => {
    const fn = mockFetch((url) => {
      if (url.endsWith('/midi')) throw new TypeError('Failed to fetch');
      return json(200, { items: [row(9)], hasNext: false });
    });
    const r = await useAdminSongs.getState().register(draft());
    expect(r).toEqual({ result: 'failed', message: adminErrorText('NETWORK') });
    expect(fn.mock.calls.map((c) => c[0])).toContain('/api/v1/admin/songs?page=0&size=100');
  });

  it('등록이 실패하면 failed와 서버 코드 문구, 5xx는 결과 미확인 문구', async () => {
    mockFetch(() => problem(422, 'MIDI_UNSUPPORTED'));
    expect(await useAdminSongs.getState().register(draft())).toEqual({ result: 'failed', message: adminErrorText('MIDI_UNSUPPORTED') });
    mockFetch(() => problem(503, 'SERVICE_UNAVAILABLE'));
    expect(await useAdminSongs.getState().register(draft())).toEqual({ result: 'failed', message: adminErrorText('HTTP_ERROR') });
  });
});

describe('adminSongStore.uploadFor', () => {
  it('성공하면 그 행만 반주 있음', async () => {
    mockFetch((url) => (url.includes('accompaniment') ? json(200, { accompanimentUrl: 'u', expiresAt: 't' }) : json(200, { items: [row(1), row(2)], hasNext: false })));
    await useAdminSongs.getState().load();
    await useAdminSongs.getState().uploadFor(2, new File(['x'], 'a.mp3'));
    const s = useAdminSongs.getState();
    expect(s.songs.map((x) => x.hasAccompaniment)).toEqual([false, true]);
    expect(s.uploading).toEqual({});
    expect(s.rowErrors).toEqual({});
  });

  it('반주 저장소를 못 쓰는 503은 결과 미확인이 아니라 저장소 문구', async () => {
    mockFetch((url) => (url.includes('accompaniment') ? problem(503, 'ACCOMPANIMENT_UNAVAILABLE') : json(200, { items: [row(1)], hasNext: false })));
    await useAdminSongs.getState().load();
    await useAdminSongs.getState().uploadFor(1, new File(['x'], 'a.mp3'));
    expect(useAdminSongs.getState().rowErrors[1]).toBe(adminErrorText('ACCOMPANIMENT_UNAVAILABLE'));
    expect(adminErrorText('ACCOMPANIMENT_UNAVAILABLE')).toContain('저장소');
  });

  it('사전 검사 실패와 서버 실패는 그 행의 오류로 남는다', async () => {
    mockFetch((url) => (url.includes('accompaniment') ? problem(422, 'ACCOMPANIMENT_UNSUPPORTED') : json(200, { items: [row(1)], hasNext: false })));
    await useAdminSongs.getState().load();
    await useAdminSongs.getState().uploadFor(1, new File(['x'], 'a.flac'));
    expect(useAdminSongs.getState().rowErrors[1]).toBe(ACCOMPANIMENT_PRECHECK_TEXT.TYPE);
    await useAdminSongs.getState().uploadFor(1, new File(['x'], 'a.mp3'));
    expect(useAdminSongs.getState().rowErrors[1]).toBe(adminErrorText('ACCOMPANIMENT_UNSUPPORTED'));
    expect(useAdminSongs.getState().songs[0].hasAccompaniment).toBe(false);
  });
});
