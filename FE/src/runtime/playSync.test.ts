import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayLog } from '@/domain/play/playLog';
import type { Report } from '@/domain/play/report';
import {
  loadAllReportNotes,
  prefetchReport,
  refreshReport,
  resetPlaySyncForTest,
  resumePlaySync,
  startPlaySync,
  subscribePrefetchedReport,
  usePlaySync,
} from './playSync';

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

  it('성공하면 연주 기록 목록 캐시를 무효화하고, 실패하면 하지 않는다 (설계 TECH-351)', async () => {
    const { queryClient } = await import('./queryClient');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    stubStorage([log()]);
    mockFetch(() => json(201, { playId: ID, rawLogStatus: 'PENDING' }));
    await startPlaySync(ID);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['plays'] });
    spy.mockClear();
    resetPlaySyncForTest();
    stubStorage([log()]);
    mockFetch(() => json(400, { code: 'BAD', detail: 'x' }, 'application/problem+json'));
    await startPlaySync(ID);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('업로드 본문의 consent는 로그에 저장된 시작 시점 값을 따른다', async () => {
    stubStorage([log({ consent: true })]);
    let fn = mockFetch(() => json(201, { playId: ID, rawLogStatus: 'PENDING' }));
    await startPlaySync(ID);
    expect(JSON.parse(String(uploadCalls(fn)[0][1]?.body)).consent).toBe(true);

    resetPlaySyncForTest();
    stubStorage([log()]);
    fn = mockFetch(() => json(201, { playId: ID, rawLogStatus: 'PENDING' }));
    await startPlaySync(ID);
    expect(JSON.parse(String(uploadCalls(fn)[0][1]?.body)).consent).toBe(false);
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

/** 리포트·노트 요청 횟수를 세고, 리포트 응답을 차례로 돌려준다 */
function mockReportFetch(...reports: (() => Response)[]) {
  const fn = vi.fn(async (url: string) => {
    if (url.includes('/report/notes')) return json(200, { items: [], nextAfterSeq: null });
    if (url.endsWith('/report')) {
      const next = reports.shift();
      if (!next) throw new Error('예상 밖 리포트 요청');
      return next();
    }
    throw new Error(`예상 밖 요청 ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const status = (analysisStatus: string) =>
  json(200, {
    playId: ID,
    score: 100,
    accuracy: 100,
    maxCombo: 1,
    judgementCounts: { perfect: 1, good: 0, miss: 0 },
    timingHistogram: null,
    padStats: [],
    mode: 'RHYTHM',
    inputSource: 'keyboard',
    endReason: null,
    analysisStatus,
    weakSegments: null,
    recommendedDrills: null,
    generatorVersion: 'v1',
    generatedAt: '2026-10-28T00:00:00Z',
  });
const err500 = () => json(500, { status: 500, code: 'INTERNAL', detail: 'x' }, 'application/problem+json');
const reportCalls = (fn: ReturnType<typeof mockReportFetch>) => fn.mock.calls.filter(([u]) => String(u).endsWith('/report'));

describe('refreshReport', () => {
  it('GET /report를 다시 받아 캐시의 report를 바꾸고 firstNotes는 유지한다', async () => {
    const fn = mockReportFetch(() => status('PENDING'), () => status('DONE'));
    const before = prefetchReport(ID);
    expect((await before.report).analysisStatus).toBe('PENDING');

    const fresh = await refreshReport(ID);
    expect(fresh.analysisStatus).toBe('DONE');
    const after = prefetchReport(ID);
    expect(after).toBe(before);
    expect(await after.report).toBe(fresh);
    expect(after.firstNotes).toBe(before.firstNotes);
    expect(reportCalls(fn)).toHaveLength(2);
  });

  it('캐시 항목이 없으면 새로 만들고 노트 첫 페이지도 시작한다', async () => {
    const fn = mockReportFetch(() => status('DONE'));
    const r = await refreshReport(ID);
    expect(await prefetchReport(ID).report).toBe(r);
    expect(fn.mock.calls.some(([u]) => String(u).includes('/report/notes'))).toBe(true);
    expect(reportCalls(fn)).toHaveLength(1);
  });

  it('실패하면 캐시를 그대로 두고 오류를 던진다', async () => {
    mockReportFetch(() => status('PENDING'), err500);
    const before = prefetchReport(ID);
    const old = await before.report;
    await expect(refreshReport(ID)).rejects.toBeTruthy();
    const after = prefetchReport(ID);
    expect(after).toBe(before);
    expect(await after.report).toBe(old);
  });
});

describe('loadAllReportNotes', () => {
  const slowReport = (playbackRate?: number) => () =>
    json(200, {
      playId: ID,
      score: 100,
      accuracy: 100,
      maxCombo: 1,
      judgementCounts: { perfect: 0, good: 1, miss: 0 },
      timingHistogram: null,
      padStats: [],
      mode: 'SHEET',
      inputSource: 'keyboard',
      endReason: null,
      ...(playbackRate === undefined ? {} : { playbackRate }),
      analysisStatus: 'DONE',
      weakSegments: [],
      recommendedDrills: null,
      generatorVersion: 'v1',
      generatedAt: '2026-11-15T00:00:00Z',
    });
  /** 노트는 한 쪽: 노트 5000을 실제로 40ms 늦게 친 GOOD(배율 0.5면 tMs 5020) */
  function mockNotes(report: () => Response) {
    const fn = vi.fn(async (url: string) => {
      if (url.includes('/report/notes')) {
        return json(200, { items: [{ seq: 0, matchedNoteId: 'a', tMs: 5020, pad: 'SNARE', judgement: 'GOOD', deltaMs: 40, velocity: 80 }], nextAfterSeq: null });
      }
      if (url.endsWith('/report')) return report();
      throw new Error(`예상 밖 요청 ${url}`);
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('미리 받은 리포트 본문의 연습 배율로 노트 시각을 구하고, 본문을 다시 요청하지 않는다', async () => {
    const fn = mockNotes(slowReport(0.5));
    prefetchReport(ID);
    const notes = await loadAllReportNotes(ID);
    expect(notes.map((n) => n.timeMs)).toEqual([5000]);
    expect(fn.mock.calls.filter(([u]) => String(u).endsWith('/report'))).toHaveLength(1);
    expect(fn.mock.calls.filter(([u]) => String(u).includes('/report/notes'))).toHaveLength(1);
  });

  it('배율이 없거나 1이면 tMs − Δ 그대로다', async () => {
    mockNotes(slowReport());
    expect((await loadAllReportNotes(ID)).map((n) => n.timeMs)).toEqual([4980]);
    resetPlaySyncForTest();
    mockNotes(slowReport(1));
    expect((await loadAllReportNotes(ID)).map((n) => n.timeMs)).toEqual([4980]);
  });

  it('리포트 본문 조회가 실패해도 노트는 배율 1로 받는다', async () => {
    mockNotes(err500);
    expect((await loadAllReportNotes(ID)).map((n) => n.timeMs)).toEqual([4980]);
  });
});

describe('subscribePrefetchedReport', () => {
  it('캐시가 없으면 null이고 요청을 시작하지 않는다', () => {
    const fn = mockReportFetch();
    const seen: (Report | null)[] = [];
    const off = subscribePrefetchedReport(ID, (r) => seen.push(r));
    expect(seen).toEqual([null]);
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it('성공하면 Report를 알린다', async () => {
    mockReportFetch(() => status('DONE'));
    prefetchReport(ID);
    const seen: (Report | null)[] = [];
    const off = subscribePrefetchedReport(ID, (r) => seen.push(r));
    await vi.waitFor(() => expect(seen.at(-1)?.analysisStatus).toBe('DONE'));
    off();
  });

  it('실패하면 null이다', async () => {
    mockReportFetch(err500);
    const entry = prefetchReport(ID);
    const seen: (Report | null)[] = [];
    const off = subscribePrefetchedReport(ID, (r) => seen.push(r));
    await entry.report.catch(() => {});
    await vi.waitFor(() => expect(seen.at(-1)).toBeNull());
    expect(seen.every((r) => r === null)).toBe(true);
    off();
  });

  it('refresh 뒤 새 값을 받고, 해제하면 더 받지 않는다', async () => {
    mockReportFetch(() => status('PENDING'), () => status('DONE'), () => status('FAILED'));
    prefetchReport(ID);
    const seen: (Report | null)[] = [];
    const off = subscribePrefetchedReport(ID, (r) => seen.push(r));
    await vi.waitFor(() => expect(seen.at(-1)?.analysisStatus).toBe('PENDING'));

    await refreshReport(ID);
    await vi.waitFor(() => expect(seen.at(-1)?.analysisStatus).toBe('DONE'));

    off();
    const n = seen.length;
    await refreshReport(ID);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(n);
  });
});
