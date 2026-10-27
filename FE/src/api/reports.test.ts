import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAllReportNotes, toReport, toReportNote, type ReportDto, type ReportNoteDto } from './reports';

const DTO: ReportDto = {
  id: 1,
  playId: '9da79b76-5d88-4875-bc71-c826c3fb4293',
  score: 160,
  accuracy: 53.33,
  maxCombo: 1,
  judgementCounts: { perfect: 1, good: 1, miss: 1 },
  timingHistogram: { binMs: 10, fromMs: -60, counts: [0, 1, 0] },
  padStats: [
    { pad: 'HI_TOM', accuracy: 80, meanDeltaMs: -12.5, meanVelocity: 90, judgementCounts: { perfect: 1, good: 0, miss: 0 }, sampleCount: 1 },
    { pad: 'KICK', accuracy: null, meanDeltaMs: null, meanVelocity: null, judgementCounts: { perfect: 0, good: 0, miss: 0 }, sampleCount: 0 },
    { pad: 'COWBELL', accuracy: '50.00', meanDeltaMs: '1', meanVelocity: '1', judgementCounts: { perfect: 1, good: 0, miss: 1 }, sampleCount: 1 },
  ],
  mode: 'SHEET',
  inputSource: 'KEYBOARD',
  endReason: 'COMPLETED',
  analysisStatus: 'NOT_REQUESTED',
  weakSegments: null,
  recommendedDrills: [],
  generatorVersion: 'BE_REPORT_V1',
  generatedAt: '2026-10-27T00:00:00Z',
};

describe('toReport', () => {
  it('정확도를 0~1로, null은 그대로, 패드 옛 이름은 바꾸고 모르는 패드는 버린다', () => {
    const r = toReport(DTO);
    expect(r.accuracy).toBeCloseTo(0.5333, 6);
    expect(r.counts).toEqual({ PERFECT: 1, GOOD: 1, MISS: 1 });
    expect(r.padStats.map((p) => p.pad)).toEqual(['SMALL_TOM', 'KICK']);
    expect(r.padStats[0]).toMatchObject({ accuracy: 0.8, meanDeltaMs: -12.5, sampleCount: 1 });
    expect(r.padStats[1]).toMatchObject({ accuracy: null, meanDeltaMs: null, meanVelocity: null });
    expect(r.weakSegments).toBeNull();
    expect(r.recommendedDrills).toEqual([]);
  });

  it('숫자가 문자열로 와도 읽는다', () => {
    expect(toReport({ ...DTO, accuracy: '84.50' }).accuracy).toBeCloseTo(0.845, 6);
  });
});

describe('toReportNote', () => {
  const n = (over: Partial<ReportNoteDto>): ReportNoteDto => ({
    seq: 0,
    matchedNoteId: 'n0',
    tMs: 505,
    pad: 'SNARE',
    judgement: 'PERFECT',
    deltaMs: 5,
    velocity: 90,
    ...over,
  });
  it('PERFECT·GOOD은 tMs − Δ, MISS는 tMs가 노트 시각', () => {
    expect(toReportNote(n({}))!.timeMs).toBe(500);
    expect(toReportNote(n({ judgement: 'MISS', tMs: 1000, deltaMs: null, velocity: null }))!.timeMs).toBe(1000);
  });
});

describe('getAllReportNotes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('nextAfterSeq가 null일 때까지 받고 시간순으로 정렬한다', async () => {
    const pages: Record<string, unknown> = {
      '': { items: [{ seq: 0, matchedNoteId: 'b', tMs: 1000, pad: 'SNARE', judgement: 'MISS', deltaMs: null, velocity: null }], nextAfterSeq: 0 },
      '0': { items: [{ seq: 1, matchedNoteId: 'a', tMs: 505, pad: 'KICK', judgement: 'PERFECT', deltaMs: 5, velocity: 80 }], nextAfterSeq: null },
    };
    const fetchMock = vi.fn(async (url: string) => {
      const after = new URL(url, 'http://x').searchParams.get('afterSeq') ?? '';
      return new Response(JSON.stringify(pages[after]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const notes = await getAllReportNotes('p');
    expect(notes.map((x) => [x.noteId, x.timeMs])).toEqual([
      ['a', 500],
      ['b', 1000],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/plays/p/report/notes?limit=1000');
  });

  it('미리 받은 첫 페이지가 있으면 그 요청을 건너뛴다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const notes = await getAllReportNotes('p', { first: { items: [], nextAfterSeq: null } });
    expect(notes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
