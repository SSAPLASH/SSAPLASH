import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayLog } from '@/engine/playLog';
import { prefetchReport, resetPlaySyncForTest, resumePlaySync, startPlaySync, usePlaySync } from './playSync';

const ID = '9da79b76-5d88-4875-bc71-c826c3fb4293';
let data: Record<string, string>;

function stubStorage(logs: PlayLog[]) {
  data = { 'ssaplash.playlogs': JSON.stringify(logs) };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  });
}

const stored = (): PlayLog => (JSON.parse(data['ssaplash.playlogs']) as PlayLog[])[0];

function log(over: Partial<PlayLog> = {}): PlayLog {
  return {
    playId: ID,
    songId: '12',
    title: 't',
    difficulty: 'EASY',
    mode: 'RHYTHM',
    inputSource: 'keyboard',
    startedAt: '2026-10-27T00:00:00.000Z',
    endedAt: '2026-10-27T00:00:10.000Z',
    durationMs: 10_000,
    timing: { perfectMs: 25, goodMs: 60 },
    calibrationId: null,
    chartVersionId: 77,
    songNumericId: 12,
    chartId: 34,
    presetId: null,
    bpm: 120,
    beatsPerBar: 4,
    hits: [{ hitId: 1, stickId: 0, pad: 'SNARE', velocity: 90, tHit: 0, tRecv: 0, tResolved: 0, seq: 0, judgement: 'PERFECT', matchedNoteIndex: 0, deltaMs: 3, tSongMs: 3 }],
    notes: [{ index: 0, timeMs: 0, pad: 'SNARE', judgement: 'PERFECT', deltaMs: 3, noteId: 'n0', seq: null }],
    summary: { score: 100, maxScore: 100, accuracy: 1, maxCombo: 1, counts: { PERFECT: 1, GOOD: 0, MISS: 0 }, strayHits: 0 },
    audioOffsetMs: 0,
    lastSongTimeMs: 1000,
    elapsedActiveMs: 3000,
    sourceNoteCount: 1,
    ...over,
  };
}

const json = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });

/** POST /plays 응답을 차례로 돌려주고 리포트 조회는 빈 응답 */
function mockFetch(...uploads: (() => Response)[]) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/plays' && init?.method === 'POST') {
      const next = uploads.shift();
      if (!next) throw new Error('예상 밖 업로드');
      return next();
    }
    if (url.includes('/report/notes')) return json(200, { items: [], nextAfterSeq: null });
    if (url.endsWith('/report')) return json(200, {});
    throw new Error(`예상 밖 요청 ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const uploadCalls = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls.filter(([u]) => u === '/api/v1/plays');

beforeEach(() => resetPlaySyncForTest());
afterEach(() => vi.unstubAllGlobals());

describe('startPlaySync', () => {
  it('성공하면 DONE, 본문을 지우고 리포트를 미리 받는다', async () => {
    stubStorage([log()]);
    const fn = mockFetch(() => json(201, { playId: ID, rawLogStatus: 'PENDING' }));
    const st = await startPlaySync(ID);
    expect(st?.status).toBe('DONE');
    expect(stored().upload).toMatchObject({ status: 'DONE', attempts: 1 });
    expect(stored().upload?.body).toBeUndefined();
    expect(usePlaySync.getState().states[ID]?.status).toBe('DONE');
    expect(fn.mock.calls.some(([u]) => String(u).endsWith(`/plays/${ID}/report`))).toBe(true);
    expect(fn.mock.calls.some(([u]) => String(u).includes(`/plays/${ID}/report/notes`))).toBe(true);
  });

  it('네트워크 실패는 재시도 가능, 재전송은 처음 본문 그대로', async () => {
    stubStorage([log()]);
    const fn = mockFetch(
      () => {
        throw new TypeError('offline');
      },
      () => json(200, { playId: ID, rawLogStatus: 'PENDING' }),
    );
    const first = await startPlaySync(ID);
    expect(first).toMatchObject({ status: 'FAILED', reason: 'NETWORK', retryable: true });
    expect(stored().upload?.body).toBeDefined();

    resumePlaySync(ID);
    await vi.waitFor(() => expect(stored().upload?.status).toBe('DONE'));
    const [a, b] = uploadCalls(fn);
    expect(b[1]?.body).toBe(a[1]?.body);
    expect(stored().upload?.attempts).toBe(2);
  });

  it('400은 재시도하지 않는다', async () => {
    stubStorage([log()]);
    const fn = mockFetch(() => json(400, { status: 400, code: 'PLAY_PAYLOAD_INVALID', detail: 'x' }, 'application/problem+json'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await startPlaySync(ID)).toMatchObject({ status: 'FAILED', reason: 'PLAY_PAYLOAD_INVALID', retryable: false });
    resumePlaySync(ID);
    await startPlaySync(ID);
    expect(uploadCalls(fn)).toHaveLength(1);
  });

  it('409 PLAY_STATE_CHANGED는 재시도 가능, 다른 409는 불가', async () => {
    stubStorage([log()]);
    mockFetch(() => json(409, { status: 409, code: 'PLAY_STATE_CHANGED', detail: 'x' }, 'application/problem+json'));
    expect((await startPlaySync(ID))?.retryable).toBe(true);
    resetPlaySyncForTest();
    stubStorage([log()]);
    mockFetch(() => json(409, { status: 409, code: 'PLAY_PAYLOAD_CONFLICT', detail: 'x' }, 'application/problem+json'));
    expect((await startPlaySync(ID))?.retryable).toBe(false);
  });

  it('내장 채보는 보내지 않고 SKIPPED', async () => {
    stubStorage([log({ songNumericId: null, chartVersionId: null })]);
    const fn = mockFetch();
    expect(await startPlaySync(ID)).toMatchObject({ status: 'SKIPPED', reason: 'BUILTIN_CHART' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('동시에 두 번 불러도 업로드는 한 번', async () => {
    stubStorage([log()]);
    const fn = mockFetch(() => json(201, { playId: ID, rawLogStatus: 'PENDING' }));
    await Promise.all([startPlaySync(ID), startPlaySync(ID)]);
    expect(uploadCalls(fn)).toHaveLength(1);
  });
});

describe('prefetchReport', () => {
  it('같은 playId는 같은 요청을 다시 쓰고, 실패하면 캐시에서 지운다', async () => {
    const fn = vi.fn(async () => json(500, { status: 500, code: 'INTERNAL', detail: 'x' }, 'application/problem+json'));
    vi.stubGlobal('fetch', fn);
    const a = prefetchReport(ID);
    expect(prefetchReport(ID)).toBe(a);
    await expect(a.report).rejects.toBeTruthy();
    await expect(a.firstNotes).rejects.toBeTruthy();
    expect(prefetchReport(ID)).not.toBe(a);
  });
});
