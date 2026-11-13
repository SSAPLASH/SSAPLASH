import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { SONG_EDIT_UNCERTAIN_TEXT } from '@/domain/song/songEdit';
import { useSongEdit } from './songEditStore';

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}
const problem = (status: number, code: string) => json(status, { status, detail: '오류', code }, 'application/problem+json');

function mockFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => resetForTest('tok'));
afterEach(() => {
  useSongEdit.getState().reset();
  vi.unstubAllGlobals();
});

describe('songEditStore', () => {
  it('saveMeta 성공이면 done, reset이 idle로 되돌린다', async () => {
    const fn = mockFetch(() => json(200, { id: 7, title: '새', artist: '', source: 'AUDIO', status: 'READY', charts: [] }));
    await useSongEdit.getState().saveMeta(7, { title: '새' });
    expect(fn.mock.calls[0][0]).toBe('/api/v1/songs/7');
    expect(fn.mock.calls[0][1]?.method).toBe('PATCH');
    expect(useSongEdit.getState()).toMatchObject({ phase: 'done', error: null });
    useSongEdit.getState().reset();
    expect(useSongEdit.getState()).toMatchObject({ phase: 'idle', error: null });
  });

  it('saveCover: set은 PUT, clear는 DELETE', async () => {
    const fn = mockFetch((_u, init) => (init?.method === 'PUT' ? json(200, { coverUrl: 'https://x/c.jpg' }) : new Response(null, { status: 204 })));
    await useSongEdit.getState().saveCover(7, { kind: 'set', blob: new Blob(['x'], { type: 'image/jpeg' }) });
    expect(fn.mock.calls[0][1]?.method).toBe('PUT');
    expect(useSongEdit.getState().phase).toBe('done');
    useSongEdit.getState().reset();
    await useSongEdit.getState().saveCover(7, { kind: 'clear' });
    expect(fn.mock.calls[1][0]).toBe('/api/v1/songs/7/cover');
    expect(fn.mock.calls[1][1]?.method).toBe('DELETE');
    expect(useSongEdit.getState().phase).toBe('done');
  });

  it('remove 204면 done', async () => {
    const fn = mockFetch(() => new Response(null, { status: 204 }));
    await useSongEdit.getState().remove(7);
    expect(fn.mock.calls[0][0]).toBe('/api/v1/songs/7');
    expect(fn.mock.calls[0][1]?.method).toBe('DELETE');
    expect(useSongEdit.getState().phase).toBe('done');
  });

  it.each([
    [400, 'SONG_INVALID', '제목(1~100자)과 아티스트(100자 이하)를 확인해 주세요.'],
    [403, 'SONG_FORBIDDEN', '내 곡만 수정할 수 있습니다.'],
    [404, 'SONG_NOT_FOUND', '이미 없는 곡입니다. 목록을 새로 고칩니다.'],
    [409, 'SONG_BUSY', '채보를 만드는 중인 곡은 바꿀 수 없습니다.'],
    [413, 'COVER_TOO_LARGE', '이미지가 너무 큽니다.'],
    [415, 'COVER_UNSUPPORTED', 'JPG·PNG·WebP 이미지만 쓸 수 있습니다.'],
  ])('%i %s → 문구, uncertain 아님', async (status, code, text) => {
    mockFetch(() => problem(status, code));
    await useSongEdit.getState().saveMeta(7, { title: '새' });
    const s = useSongEdit.getState();
    expect(s.phase).toBe('failed');
    expect(s.error).toEqual({ code, text, uncertain: false });
  });

  it('5xx는 코드가 있어도 uncertain', async () => {
    mockFetch(() => problem(500, 'SONG_INVALID'));
    await useSongEdit.getState().remove(7);
    expect(useSongEdit.getState().error).toMatchObject({ text: SONG_EDIT_UNCERTAIN_TEXT, uncertain: true });
  });

  it('503 COVER_UNAVAILABLE(저장소 장애)은 저장 전 실패라 문구를 보이고 uncertain 아님', async () => {
    mockFetch(() => problem(503, 'COVER_UNAVAILABLE'));
    await useSongEdit.getState().saveCover(7, { kind: 'set', blob: new Blob(['x'], { type: 'image/jpeg' }) });
    expect(useSongEdit.getState().error).toEqual({
      code: 'COVER_UNAVAILABLE',
      text: '지금은 커버를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      uncertain: false,
    });
  });

  it('네트워크 실패·알 수 없는 코드는 uncertain', async () => {
    mockFetch(() => {
      throw new TypeError('fail');
    });
    await useSongEdit.getState().remove(7);
    expect(useSongEdit.getState().error).toMatchObject({ code: 'NETWORK', text: SONG_EDIT_UNCERTAIN_TEXT, uncertain: true });
    useSongEdit.getState().reset();
    mockFetch(() => problem(418, 'TEAPOT'));
    await useSongEdit.getState().remove(7);
    expect(useSongEdit.getState().error).toMatchObject({ code: 'TEAPOT', uncertain: true });
  });

  it('저장 중 재호출은 무시한다', async () => {
    let release: (r: Response) => void = () => undefined;
    const fn = mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const first = useSongEdit.getState().remove(7);
    await useSongEdit.getState().remove(8);
    await useSongEdit.getState().saveMeta(9, { title: 'x' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(useSongEdit.getState().phase).toBe('saving');
    release(new Response(null, { status: 204 }));
    await first;
    expect(useSongEdit.getState().phase).toBe('done');
  });
});
