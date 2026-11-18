import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAllReportNotes, toReport, toCoachSummary, toReportNote, toWeakSegments, type ReportDto, type ReportNoteDto } from './reports';

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

  it('곡 정보 선택 필드가 없으면 null, 있으면 읽고 이상한 값은 null', () => {
    expect(toReport(DTO)).toMatchObject({ songId: null, chartId: null, difficulty: null });
    expect(toReport({ ...DTO, songId: 12, chartId: '34', difficulty: 'HARD' })).toMatchObject({ songId: 12, chartId: 34, difficulty: 'HARD' });
    expect(toReport({ ...DTO, songId: 0, chartId: 'x', difficulty: 'EXTREME' })).toMatchObject({ songId: null, chartId: null, difficulty: null });
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
  it('연습 배율이 있으면 PERFECT·GOOD은 tMs − Δ × 배율(tMs는 곡 시각, Δ는 실제 시간), MISS는 tMs 그대로', () => {
    // 배율 0.5: 노트 5000을 실제로 40ms 늦게 치면 tMs 5020, 노트 7000을 30ms 빨리 치면 tMs 6985
    expect(toReportNote(n({ judgement: 'GOOD', tMs: 5020, deltaMs: 40 }), 0.5)!.timeMs).toBe(5000);
    expect(toReportNote(n({ judgement: 'GOOD', tMs: 6985, deltaMs: -30 }), 0.5)!.timeMs).toBe(7000);
    expect(toReportNote(n({ judgement: 'MISS', tMs: 9000, deltaMs: null, velocity: null }), 0.5)!.timeMs).toBe(9000);
    // 오차 값 자체는 실제 시간 그대로 둔다
    expect(toReportNote(n({ judgement: 'GOOD', tMs: 5020, deltaMs: 40 }), 0.5)!.deltaMs).toBe(40);
  });
  it('배율이 1이거나 유한한 양수가 아니면 tMs − Δ와 같다', () => {
    for (const rate of [1, undefined, 0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toReportNote(n({ judgement: 'GOOD', tMs: 5020, deltaMs: 40 }), rate)!.timeMs).toBe(4980);
    }
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

  it('rate를 모든 쪽의 노트에 곱하고, 바뀐 노트 시각으로 정렬한다', async () => {
    // 배율 0.5. 옛 식이면 a가 4980, b가 4990이라 a가 앞이지만, 실제 노트 시각은 a 5000 · b 4995다
    const first = { items: [{ seq: 0, matchedNoteId: 'a', tMs: 5020, pad: 'SNARE', judgement: 'GOOD' as const, deltaMs: 40, velocity: 80 }], nextAfterSeq: 0 };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [{ seq: 1, matchedNoteId: 'b', tMs: 5000, pad: 'KICK', judgement: 'PERFECT', deltaMs: 10, velocity: 80 }], nextAfterSeq: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const notes = await getAllReportNotes('p', { first, rate: 0.5 });
    expect(notes.map((x) => [x.noteId, x.timeMs])).toEqual([
      ['b', 4995],
      ['a', 5000],
    ]);
  });
});

// AI 샘플(develop-AI AI/tests/fixtures/coach/samples.json)의 response.weakSegments 복사
const SAMPLE_A = [
  {
    fromMs: 2000,
    toMs: 14501,
    pattern: 'TIMING_LATE',
    description: '전체적으로 평균 22ms 늦게 치고 있어요.',
    tip: '스틱을 미리 올려 두고, 박 소리가 들리는 순간 내려쳐 보세요. 느린 템포부터 시작하면 감이 빨리 와요.',
    detail: '박마다 평균 22ms씩 늦게 들어가고 있어요.',
    severityLevel: 'LOW',
    causeTags: ['LATE', 'OVERALL'],
    pads: ['HIHAT', 'SNARE'],
    metrics: { severity: 0.36, meanDeltaMs: 21.7, hitCount: 22, scope: 'WHOLE' },
  },
  {
    fromMs: 7000,
    toMs: 12000,
    pattern: 'MISS_CLUSTER',
    description: '7~12초 구간에서 노트의 40%를 놓쳤어요.',
    tip: '놓친 부분만 따로 떼어 느린 템포로 반복해 보세요. 한 번에 한 마디씩 익히면 곡 전체가 쉬워져요.',
    detail: '이 구간에서 4개를 놓쳤어요.',
    severityLevel: 'HIGH',
    causeTags: ['MISS', 'CLUSTER'],
    pads: ['SNARE'],
    metrics: { severity: 0.67, missRate: 0.4, missCount: 4, noteCount: 10, scope: 'SEGMENT' },
  },
];
const SAMPLE_B: unknown[] = [];
const SAMPLE_C: unknown[] = [];

const seg = (over: Record<string, unknown> = {}) => ({ ...SAMPLE_A[1], ...over });

describe('toWeakSegments', () => {
  it('샘플 A는 연주 전체 1개 + 구간 1개로 순서대로 변환한다', () => {
    const r = toWeakSegments(SAMPLE_A)!;
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ fromMs: 2000, toMs: 14501, pattern: 'TIMING_LATE', scope: 'WHOLE', severity: 0.36, pads: ['HIHAT', 'SNARE'], causeTags: ['LATE', 'OVERALL'] });
    expect(r[0].metrics).toEqual({ meanDeltaMs: 21.7, hitCount: 22 });
    expect(r[1]).toMatchObject({ fromMs: 7000, toMs: 12000, pattern: 'MISS_CLUSTER', scope: 'SEGMENT', severity: 0.67, pads: ['SNARE'] });
    expect(r[1].metrics).toEqual({ missRate: 0.4, missCount: 4, noteCount: 10 });
  });

  it('tip은 비어 있지 않은 문자열이면 그대로 보관하고, 없거나 빈 문자열·숫자면 필드 자체가 없다', () => {
    const r = toWeakSegments(SAMPLE_A)!;
    expect(r[0].tip).toBe(SAMPLE_A[0].tip);
    expect(r[1].tip).toBe(SAMPLE_A[1].tip);
    const noTip = { ...SAMPLE_A[1] } as Record<string, unknown>;
    delete noTip.tip;
    for (const el of [noTip, seg({ tip: '' }), seg({ tip: 5 }), seg({ tip: null })]) {
      const [s] = toWeakSegments([el])!;
      expect('tip' in s).toBe(false);
    }
    // 자르거나 다듬지 않는다
    const [t] = toWeakSegments([seg({ tip: '  앞뒤 공백 유지  ' })])!;
    expect(t.tip).toBe('  앞뒤 공백 유지  ');
  });

  it('detail·severityLevel을 보관하고, 모르는 단계·숫자·빈 detail은 키 자체가 없다', () => {
    const r = toWeakSegments(SAMPLE_A)!;
    expect(r[0]).toMatchObject({ detail: SAMPLE_A[0].detail, severityLevel: 'LOW' });
    expect(r[1]).toMatchObject({ detail: SAMPLE_A[1].detail, severityLevel: 'HIGH' });
    for (const el of [seg({ severityLevel: 'SEVERE' }), seg({ severityLevel: 3 }), seg({ severityLevel: null })]) {
      expect('severityLevel' in toWeakSegments([el])![0]).toBe(false);
    }
    for (const el of [seg({ detail: '' }), seg({ detail: 5 }), seg({ detail: null })]) {
      expect('detail' in toWeakSegments([el])![0]).toBe(false);
    }
  });

  it('샘플 B·C(빈 배열)는 빈 배열, null은 null, 배열이 아니면 null', () => {
    expect(toWeakSegments(SAMPLE_B)).toEqual([]);
    expect(toWeakSegments(SAMPLE_C)).toEqual([]);
    expect(toWeakSegments(null)).toBeNull();
    expect(toWeakSegments(undefined)).toBeNull();
    expect(toWeakSegments('약점')).toBeNull();
    expect(toWeakSegments({ a: 1 })).toBeNull();
  });

  it('description이 비었거나 문자열이 아니거나 fromMs·toMs가 숫자가 아닌 요소와 객체가 아닌 요소는 버린다', () => {
    const r = toWeakSegments([seg({ description: '' }), seg({ description: 3 }), seg({ fromMs: 'abc' }), seg({ toMs: null }), seg({ fromMs: '' }), 'x', null, seg()])!;
    expect(r).toHaveLength(1);
  });

  it('모르는 pattern·추가 metrics 키·추가 causeTags는 그대로 통과한다', () => {
    const [r] = toWeakSegments([seg({ pattern: 'NEW_PATTERN', causeTags: ['A', 'NEW'], metrics: { severity: 0.5, scope: 'SEGMENT', extra: { x: 1 } } })])!;
    expect(r.pattern).toBe('NEW_PATTERN');
    expect(r.causeTags).toEqual(['A', 'NEW']);
    expect(r.metrics).toEqual({ extra: { x: 1 } });
  });

  it('pattern이 문자열이 아니면 빈 문자열, causeTags가 배열이 아니면 빈 배열, metrics가 객체가 아니면 빈 객체', () => {
    const [r] = toWeakSegments([seg({ pattern: 5, causeTags: 'LATE', metrics: 'x' })])!;
    expect(r).toMatchObject({ pattern: '', causeTags: [], metrics: {}, severity: 0, scope: 'SEGMENT' });
  });

  it('패드는 옛 이름을 정규화하고 모르는 패드는 버린다', () => {
    const [r] = toWeakSegments([seg({ pads: ['HI_TOM', 'COWBELL', 'SNARE', 7] })])!;
    expect(r.pads).toEqual(['SMALL_TOM', 'SNARE']);
  });

  it('숫자 문자열 시각을 받고 severity는 0~1로 자르며 없으면 0, scope가 이상하면 SEGMENT', () => {
    const [a] = toWeakSegments([seg({ fromMs: '7000.0', toMs: '12000.0' })])!;
    expect(a).toMatchObject({ fromMs: 7000, toMs: 12000 });
    expect(toWeakSegments([seg({ metrics: { severity: 1.5 } })])![0].severity).toBe(1);
    expect(toWeakSegments([seg({ metrics: { severity: -0.2 } })])![0].severity).toBe(0);
    expect(toWeakSegments([seg({ metrics: { scope: 'WHOLE' } })])![0]).toMatchObject({ severity: 0, scope: 'WHOLE' });
    expect(toWeakSegments([seg({ metrics: { severity: 'x', scope: 'ALL' } })])![0]).toMatchObject({ severity: 0, scope: 'SEGMENT' });
  });

  it('toReport가 weakSegments를 변환하고 null과 빈 배열을 구분한다', () => {
    expect(toReport({ ...DTO, weakSegments: SAMPLE_A }).weakSegments).toHaveLength(2);
    expect(toReport({ ...DTO, weakSegments: [] }).weakSegments).toEqual([]);
    expect(toReport({ ...DTO, weakSegments: null }).weakSegments).toBeNull();
  });
});

describe('toCoachSummary', () => {
  const ok = { level: 'FAIR', text: '박자는 안정적이에요.', focusPattern: 'TIMING_LATE', source: 'RULE' };

  it('정상 객체를 그대로 변환한다', () => {
    expect(toCoachSummary(ok)).toEqual(ok);
  });

  it('null·없음·객체 아님·text 비었거나 문자열 아님은 null', () => {
    expect(toCoachSummary(null)).toBeNull();
    expect(toCoachSummary(undefined)).toBeNull();
    expect(toCoachSummary('총평')).toBeNull();
    expect(toCoachSummary([ok])).toBeNull();
    expect(toCoachSummary({ ...ok, text: '' })).toBeNull();
    expect(toCoachSummary({ ...ok, text: 3 })).toBeNull();
  });

  it('level이 없으면 빈 문자열, 모르는 level은 그대로, focusPattern·source가 문자열이 아니면 null', () => {
    expect(toCoachSummary({ text: 'a' })).toEqual({ level: '', text: 'a', focusPattern: null, source: null });
    expect(toCoachSummary({ ...ok, level: 'EXCELLENT' })!.level).toBe('EXCELLENT');
    expect(toCoachSummary({ ...ok, focusPattern: 1, source: null })).toMatchObject({ focusPattern: null, source: null });
  });

  it('toReport가 coachSummary를 변환하고, 없으면 null', () => {
    expect(toReport({ ...DTO, coachSummary: ok }).coachSummary).toEqual(ok);
    expect(toReport(DTO).coachSummary).toBeNull();
    expect(toReport({ ...DTO, coachSummary: null }).coachSummary).toBeNull();
  });
});
