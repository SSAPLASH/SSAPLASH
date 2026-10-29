import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from './auth';
import { uploadMidi } from './songs';

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
