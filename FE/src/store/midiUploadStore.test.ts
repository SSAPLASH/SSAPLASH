import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/auth';
import { MIDI_UNCERTAIN_TEXT, type MidiDraft } from '@/domain/midiUpload';
import { useMidiUpload } from './midiUploadStore';

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}
const problem = (status: number, code: string, detail = '오류') => json(status, { status, detail, code }, 'application/problem+json');
const created = () => json(201, { id: 7, title: '곡', artist: '', source: 'MIDI', status: 'READY', charts: [] });

function mockFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const draft = (over: Partial<MidiDraft> = {}): MidiDraft => ({ file: new File(['abc'], 'a.mid'), title: '곡', artist: '', ...over });

beforeEach(() => resetForTest('tok'));
afterEach(() => {
  useMidiUpload.getState().reset();
  vi.unstubAllGlobals();
});

describe('midiUploadStore', () => {
  it('201이면 done과 곡을 보관하고 reset이 idle로 되돌린다', async () => {
    mockFetch(() => created());
    await useMidiUpload.getState().upload(draft());
    const s = useMidiUpload.getState();
    expect(s.phase).toBe('done');
    expect(s.song?.id).toBe(7);
    expect(s.song?.source).toBe('MIDI');
    useMidiUpload.getState().reset();
    expect(useMidiUpload.getState()).toMatchObject({ phase: 'idle', song: null, error: null });
  });

  it.each([
    [400, 'MIDI_INVALID', '제목(1~100자)과 파일을 확인해 주세요.'],
    [413, 'MIDI_TOO_LARGE', '1 MiB 이하 MIDI만 올릴 수 있어요.'],
    [422, 'MIDI_NO_DRUM_NOTES', '드럼 채널(10)에 드럼 노트가 있는 MIDI를 올려 주세요.'],
    [422, 'MIDI_UNSUPPORTED', 'BE 문장'],
  ])('%i %s 문구', async (status, code, text) => {
    mockFetch(() => problem(status, code, 'BE 문장'));
    await useMidiUpload.getState().upload(draft());
    const s = useMidiUpload.getState();
    expect(s.phase).toBe('failed');
    expect(s.error).toEqual({ code, text, uncertain: false });
  });

  it('5xx·알 수 없는 코드·네트워크 오류는 uncertain', async () => {
    mockFetch(() => problem(503, 'SOMETHING', '점검 중'));
    await useMidiUpload.getState().upload(draft());
    expect(useMidiUpload.getState().error).toMatchObject({ text: MIDI_UNCERTAIN_TEXT, uncertain: true });

    useMidiUpload.getState().reset();
    mockFetch(() => problem(500, 'MIDI_UNSUPPORTED', 'x'));
    await useMidiUpload.getState().upload(draft());
    expect(useMidiUpload.getState().error).toMatchObject({ text: MIDI_UNCERTAIN_TEXT, uncertain: true });

    useMidiUpload.getState().reset();
    mockFetch(() => {
      throw new TypeError('fail');
    });
    await useMidiUpload.getState().upload(draft());
    expect(useMidiUpload.getState().error).toMatchObject({ text: MIDI_UNCERTAIN_TEXT, uncertain: true });
  });

  it('uploading 중 다시 부르면 무시한다', async () => {
    let release: (r: Response) => void = () => {};
    const fetch = mockFetch(() => new Promise<Response>((r) => (release = r)));
    const first = useMidiUpload.getState().upload(draft());
    expect(useMidiUpload.getState().phase).toBe('uploading');
    await useMidiUpload.getState().upload(draft());
    expect(fetch).toHaveBeenCalledTimes(1);
    release(created());
    await first;
    expect(useMidiUpload.getState().phase).toBe('done');
  });

  it('사전 검사에 실패하면 요청 없이 failed', async () => {
    const fetch = mockFetch(() => created());
    await useMidiUpload.getState().upload(draft({ file: new File([], 'e.mid') }));
    expect(fetch).not.toHaveBeenCalled();
    expect(useMidiUpload.getState()).toMatchObject({ phase: 'failed', error: { code: 'EMPTY', uncertain: false } });
  });
});
