import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { ApiError } from '@/api/http';
import { deleteRecording, getRecording, listRecordings, renameRecording, saveRecording } from './recordings';
import type { RecordingBody } from '@/domain/play/recording';

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

const SUMMARY = {
  id: 5, clientKey: 'k', title: '제목', mode: 'FREE', inputSource: 'KEYBOARD', playId: null, hitCount: 1,
  durationMs: 1000, startedAt: '2026-11-03T01:00:00Z', createdAt: '2026-11-03T01:00:01Z', updatedAt: '2026-11-03T01:00:01Z',
};

const BODY: RecordingBody = {
  schemaVersion: 1, clientKey: 'k', title: '제목', mode: 'FREE', inputSource: 'KEYBOARD',
  startedAt: '2026-11-03T01:00:00.000Z', durationMs: 1000, hits: [{ tMs: 1, pad: 'SNARE', velocity: 100 }],
};

beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('saveRecording', () => {
  it('POST /api/v1/recordings에 본문을 그대로 JSON으로 보낸다', async () => {
    const fn = mockFetch(() => json(201, SUMMARY));
    const res = await saveRecording(BODY);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/recordings');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(BODY);
    expect(res.id).toBe(5);
  });

  it('200(재전송)도 성공이고 song이 없으면 null이다', async () => {
    mockFetch(() => json(200, SUMMARY));
    expect((await saveRecording(BODY)).song).toBeNull();
  });

  it('song이 있으면 그대로 둔다', async () => {
    const song = { songId: 3, title: '곡', difficulty: 'EASY' };
    mockFetch(() => json(201, { ...SUMMARY, song }));
    expect((await saveRecording(BODY)).song).toEqual(song);
  });

  it('오류는 ApiError로 던지고 재시도하지 않는다', async () => {
    const fn = mockFetch(() => json(503, { status: 503, code: 'RECORDING_BUSY', detail: '바쁨' }, 'application/problem+json'));
    await expect(saveRecording(BODY)).rejects.toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('listRecordings', () => {
  const page = { items: [SUMMARY], page: 0, size: 20, totalElements: 1, totalPages: 1, hasNext: false };

  it('값 없는 쿼리는 넣지 않는다', async () => {
    const fn = mockFetch(() => json(200, page));
    await listRecordings({ q: '  ', mode: undefined });
    expect(fn.mock.calls[0][0]).toBe('/api/v1/recordings');
    await listRecordings();
    expect(fn.mock.calls[1][0]).toBe('/api/v1/recordings');
  });

  it('q·page·size·sort·mode를 쿼리로 조립한다', async () => {
    const fn = mockFetch(() => json(200, page));
    await listRecordings({ q: ' 봄 ', page: 0, size: 20, sort: 'OLDEST', mode: 'SHEET' });
    const url = new URL(fn.mock.calls[0][0], 'http://x');
    expect(url.pathname).toBe('/api/v1/recordings');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '봄', page: '0', size: '20', sort: 'OLDEST', mode: 'SHEET' });
  });

  it('항목의 song undefined를 null로 정규화한다', async () => {
    mockFetch(() => json(200, page));
    const res = await listRecordings();
    expect(res.items[0].song).toBeNull();
    expect(res.hasNext).toBe(false);
  });
});

describe('getRecording', () => {
  it('GET /{id}로 상세를 받고 song을 정규화한다', async () => {
    const fn = mockFetch(() => json(200, { ...SUMMARY, timing: null, hits: [{ tMs: 1, pad: 'SNARE', velocity: 100 }] }));
    const d = await getRecording(5);
    expect(fn.mock.calls[0][0]).toBe('/api/v1/recordings/5');
    expect(d.song).toBeNull();
    expect(d.hits).toHaveLength(1);
  });
});

describe('renameRecording', () => {
  it('PATCH 본문은 {title}만이다', async () => {
    const fn = mockFetch(() => json(200, { ...SUMMARY, title: '새 제목' }));
    const res = await renameRecording(5, '새 제목');
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/recordings/5');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ title: '새 제목' });
    expect(res.title).toBe('새 제목');
  });
});

describe('deleteRecording', () => {
  it('DELETE 204를 undefined로 처리한다', async () => {
    const fn = mockFetch(() => new Response(null, { status: 204 }));
    await expect(deleteRecording(5)).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/recordings/5');
    expect(init?.method).toBe('DELETE');
  });

  it('404는 ApiError', async () => {
    mockFetch(() => json(404, { status: 404, code: 'RECORDING_NOT_FOUND', detail: '없음' }, 'application/problem+json'));
    await expect(deleteRecording(9)).rejects.toMatchObject({ code: 'RECORDING_NOT_FOUND' });
  });
});
