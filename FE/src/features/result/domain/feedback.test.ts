import { describe, expect, it } from 'vitest';
import { buildFeedback, chartFromLog, summarizeByPad, summarizeOpenHihat } from './feedback';
import type { Chart } from '@/domain/song/chart';
import type { Judgement } from '@/domain/play/judgement';
import type { PadId } from '@/domain/kit/pads';
import type { PlayLog } from '@/domain/play/playLog';

// bpm 120 → 마디 2000ms
const chart: Chart = {
  songId: 't',
  title: 't',
  difficulty: 'EASY',
  bpm: 120,
  offsetMs: 0,
  beatsPerBar: 4,
  notes: [],
  source: 'BUILTIN',
  durationMs: 16_000,
};

type N = { bar: number; pad: PadId; j: Judgement | null; d: number | null };

function logOf(ns: N[], stray = 0, goodMs = 60): PlayLog {
  const counts: Record<Judgement, number> = { PERFECT: 0, GOOD: 0, MISS: 0 };
  for (const n of ns) counts[n.j ?? 'MISS'] += 1;
  const score = counts.PERFECT * 100 + counts.GOOD * 60;
  return {
    playId: 'p',
    songId: 't',
    title: 't',
    difficulty: 'EASY',
    mode: 'SHEET',
    inputSource: 'keyboard',
    startedAt: '2026-10-21T00:00:00.000Z',
    durationMs: 16_000,
    timing: { perfectMs: 25, goodMs },
    calibrationId: null,
    chartVersionId: null,
    songNumericId: null,
    chartId: null,
    presetId: null,
    bpm: 120,
    beatsPerBar: 4,
    hits: [],
    notes: ns.map((n, index) => ({
      index,
      timeMs: n.bar * 2000 + index,
      pad: n.pad,
      judgement: n.j,
      deltaMs: n.d,
    })),
    summary: {
      score,
      maxScore: ns.length * 100,
      accuracy: ns.length ? score / (ns.length * 100) : 0,
      maxCombo: 0,
      counts,
      strayHits: stray,
    },
  };
}

const perfect = (bar: number, pad: PadId = 'SNARE'): N => ({ bar, pad, j: 'PERFECT', d: 0 });
const miss = (bar: number, pad: PadId = 'SNARE'): N => ({ bar, pad, j: 'MISS', d: null });
const good = (bar: number, pad: PadId, d: number): N => ({ bar, pad, j: 'GOOD', d });
const many = (n: number, f: (i: number) => N): N[] => Array.from({ length: n }, (_, i) => f(i));
/**
 * 규칙 3용: 0~3·8~11마디 전부 PERFECT, 4~7마디 전부 GOOD(80%). 전체 96% − 구간 80% = 16%p.
 * GOOD이 60점일 때는 0~7마디만으로 26.7%p였으나 80점(330번)에서는 13.3%p라 앞뒤 PERFECT 구간을 둔다
 */
const weakBars4to7 = (): N[] => [
  ...many(16, (i) => perfect(Math.floor(i / 4))),
  ...many(8, (i) => good(4 + Math.floor(i / 2), 'KICK', 0)),
  ...many(16, (i) => perfect(8 + Math.floor(i / 4))),
];

describe('buildFeedback', () => {
  it('규칙 1: 패드 MISS 비율 25% 이상이면 그 패드 카드', () => {
    const ns = [...many(8, (i) => perfect(i % 4, 'KICK')), miss(0), miss(2), perfect(1), perfect(3)];
    const f = buildFeedback(logOf(ns), chart);
    expect(f[0]).toMatchObject({ id: 'pad-miss', title: '스네어를 자주 놓쳐요', pads: ['SNARE'], bars: [0, 2] });
    expect(f[0].suggestion).toContain('1~3마디');
  });

  it('규칙 1: 노트가 4개 미만이면 비율이 높아도 무시', () => {
    const ns = [...many(8, (i) => perfect(i % 4, 'KICK')), miss(0), miss(1), miss(2)];
    expect(buildFeedback(logOf(ns), chart).some((x) => x.id === 'pad-miss')).toBe(false);
  });

  it('규칙 2: 평균 Δ가 15ms 이상이면 늦어요/빨라요', () => {
    const late = buildFeedback(logOf(many(8, (i) => good(i % 4, 'KICK', 20))), chart);
    expect(late[0]).toMatchObject({ id: 'mean-delta', title: '전체적으로 늦어요' });
    expect(late[0].body).toContain('+20ms');
    const early = buildFeedback(logOf(many(8, (i) => good(i % 4, 'KICK', -20))), chart);
    expect(early[0].title).toBe('전체적으로 빨라요');
  });

  it('규칙 3: 4마디 구간 정확도가 전체보다 15%p 이상 낮으면 구간 카드', () => {
    const ns = weakBars4to7();
    const f = buildFeedback(logOf(ns), chart);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: 'segment', title: '5~8마디에서 흔들려요', bars: [4, 7] });
  });

  it('규칙 3: SHEET 로그의 bpm·beatsPerBar로 마디 규칙이 돈다(ResultPage 경로)', () => {
    const ns = weakBars4to7();
    const log = logOf(ns);
    const f = buildFeedback(log, { bpm: log.bpm, beatsPerBar: log.beatsPerBar });
    expect(f[0]).toMatchObject({ id: 'segment', bars: [4, 7] });
  });

  it('규칙 3: offsetMs가 있으면 마디를 원점부터 센다(음원 곡 약점 마디가 밀리지 않는다)', () => {
    // 노트 시각을 1250ms 뒤로 민 로그. 원점 없이 세면 5~8마디 구간이 6~9마디로 흩어진다
    const ns = weakBars4to7();
    const base = logOf(ns);
    const log = { ...base, offsetMs: 1250, notes: base.notes.map((n) => ({ ...n, timeMs: n.timeMs + 1250 })) };
    const f = buildFeedback(log, { bpm: log.bpm, beatsPerBar: log.beatsPerBar, offsetMs: log.offsetMs });
    expect(f[0]).toMatchObject({ id: 'segment', bars: [4, 7] });
    // offsetMs 필드가 없는 이전 로그는 0으로 읽혀 그대로 돈다
    const legacy = buildFeedback(base, { bpm: base.bpm, beatsPerBar: base.beatsPerBar });
    expect(legacy[0]).toMatchObject({ id: 'segment', bars: [4, 7] });
  });

  it('규칙 3: 마디 정보가 없으면(chart 없음) 건너뛴다', () => {
    const ns = [...many(16, (i) => perfect(Math.floor(i / 4))), ...many(8, (i) => good(4 + i, 'KICK', 0))];
    expect(buildFeedback(logOf(ns)).some((x) => x.id === 'segment')).toBe(false);
  });

  it('규칙 4: 패드 Δ 표준편차 0.5×goodMs 이상', () => {
    const ds = [-40, 40, -40, 40, -40, 40];
    const f = buildFeedback(logOf(ds.map((d, i) => good(i % 4, 'HIHAT', d))), chart);
    expect(f[0]).toMatchObject({ id: 'pad-jitter', title: '하이햇 타이밍이 들쭉날쭉해요', pads: ['HIHAT'] });
  });

  it('규칙 4: window 방식에서 goodMs 50이면 표준편차 26ms는 걸리고 24ms는 안 걸린다', () => {
    const jitterOf = (d: number) =>
      buildFeedback(logOf([-d, d, -d, d, -d, d].map((x, i) => good(i % 4, 'HIHAT', x)), 0, 50), chart, 'window').some(
        (x) => x.id === 'pad-jitter',
      );
    expect(jitterOf(26)).toBe(true);
    expect(jitterOf(24)).toBe(false);
  });

  it('규칙 5: 채보 밖 타격이 노트 수의 10% 이상', () => {
    const ns = many(20, (i) => perfect(i % 8));
    expect(buildFeedback(logOf(ns, 1), chart)[0].id).toBe('stable');
    const f = buildFeedback(logOf(ns, 2), chart);
    expect(f[0]).toMatchObject({ id: 'stray', title: '채보에 없는 타격이 많아요' });
  });

  it('우선순위순으로 최대 3개', () => {
    const ns = [
      ...many(8, (i) => (i % 2 ? miss(i % 4) : good(i % 4, 'SNARE', 45))),
      ...many(8, (i) => good(4 + (i % 4), 'KICK', i % 2 ? 45 : 25)),
    ];
    const f = buildFeedback(logOf(ns, 10), chart);
    expect(f).toHaveLength(3);
    expect(f.map((x) => x.id)).toEqual(['pad-miss', 'mean-delta', 'segment']);
  });

  it('조건이 없으면 "안정적이에요"', () => {
    const f = buildFeedback(logOf(many(16, (i) => perfect(i % 8))), chart);
    expect(f).toHaveLength(1);
    expect(f[0].title).toBe('안정적이에요');
    expect(f[0].body).toContain('100%');
  });
});

describe('summarizeByPad', () => {
  it('패드별 판정 수와 Δ 평균', () => {
    const ns: N[] = [
      { bar: 0, pad: 'KICK', j: 'PERFECT', d: 10 },
      { bar: 0, pad: 'KICK', j: 'GOOD', d: 30 },
      miss(1, 'KICK'),
      { bar: 0, pad: 'CRASH', j: 'PERFECT', d: -5 },
    ];
    const s = summarizeByPad(logOf(ns));
    expect(s.map((x) => x.pad)).toEqual(['CRASH', 'KICK']);
    expect(s[1]).toMatchObject({ pad: 'KICK', total: 3, perfect: 1, good: 1, miss: 1, meanDeltaMs: 20 });
  });

  it('판정 전 노트(null)는 분모에서 뺀다', () => {
    const s = summarizeByPad(logOf([{ bar: 0, pad: 'KICK', j: 'PERFECT', d: 0 }, { bar: 0, pad: 'KICK', j: null, d: null }]));
    expect(s[0]).toMatchObject({ pad: 'KICK', total: 1, perfect: 1, miss: 0 });
  });
});

describe('chartFromLog', () => {
  it('bpm이 없는 이전 로그는 null', () => {
    const log = logOf([perfect(0)]);
    expect(chartFromLog({ ...log, bpm: 0 })).toBeNull();
    expect(chartFromLog({ ...log, bpm: undefined as unknown as number })).toBeNull();
  });

  it('노트의 pad·timeMs를 순서대로 보존하고 bpm·박자를 옮긴다', () => {
    const log = logOf([perfect(0, 'KICK'), miss(1, 'HIHAT'), good(2, 'SNARE', 20)]);
    const c = chartFromLog(log)!;
    expect(c.bpm).toBe(120);
    expect(c.beatsPerBar).toBe(4);
    expect(c.notes).toEqual(log.notes.map((n) => ({ pad: n.pad, timeMs: n.timeMs })));
  });

  it('offsetMs를 격자 원점으로 옮기고, 없는 이전 로그는 0이다', () => {
    const log = logOf([perfect(0, 'KICK')]);
    expect(chartFromLog({ ...log, offsetMs: 1250 })!.offsetMs).toBe(1250);
    expect(chartFromLog(log)!.offsetMs).toBe(0);
  });
});

describe('패드 표준편차 기준 방식(코칭 기준 폭)', () => {
  const jitterOf = (d: number, goodMs: number, basis?: 'fixed' | 'window') =>
    buildFeedback(
      logOf([-d, d, -d, d, -d, d].map((x, i) => good(i % 4, 'HIHAT', x)), 0, goodMs),
      chart,
      basis,
    ).some((x) => x.id === 'pad-jitter');

  it('fixed(기본): 사용자 goodMs와 무관하게 60 기준(30ms)이다', () => {
    for (const g of [50, 60, 150]) {
      expect(jitterOf(31, g), `goodMs=${g}`).toBe(true);
      expect(jitterOf(29, g), `goodMs=${g}`).toBe(false);
    }
  });

  it('window: goodMs에 비례한다(이전 동작)', () => {
    expect(jitterOf(26, 50, 'window')).toBe(true);
    expect(jitterOf(24, 50, 'window')).toBe(false);
    expect(jitterOf(31, 150, 'window')).toBe(false);
  });
});


describe('열린 하이햇 결과', () => {
  const base = logOf(Array.from({ length: 12 }, () => perfect(0, 'HIHAT')));
  const open = { ...base, hihatPedalCoverage: 'COMPLETE' as const, lastSongTimeMs: base.durationMs, notes: base.notes.map((n) => ({ ...n, hihatOpen: true as const })) };
  const hits = Array.from({ length: 9 }, (_, i) => ({ hitId: i, stickId: 0 as const, pad: 'HIHAT' as const, velocity: 90, tHit: 0, tRecv: 0, tResolved: 0, judgement: 'PERFECT' as const, matchedNoteIndex: i, hihatClosed: false }));
  it('유일 노트 성공만 세고 0타격 완주도 표시한다', () => {
    expect(summarizeOpenHihat({ ...open, hits: [...hits, hits[0], { ...hits[0], matchedNoteIndex: 9, hihatClosed: true }] })?.text).toBe('열린 9/12');
    expect(summarizeOpenHihat(open)?.text).toBe('열린 0/12');
    expect(chartFromLog(open)?.notes[0].hihatOpen).toBe(true);
  });
  it('불완전, 중도 종료와 구 로그·다른 모드를 구분한다', () => {
    expect(summarizeOpenHihat({ ...open, hihatPedalCoverage: 'PARTIAL' })?.text).toBe('열린 하이햇 · 측정 불완전');
    expect(summarizeOpenHihat({ ...open, lastSongTimeMs: 100 })?.text).toContain('전체 채보 기준');
    expect(summarizeOpenHihat({ ...open, hihatPedalCoverage: 'NONE' })).toBeNull();
    expect(summarizeOpenHihat({ ...open, hihatPedalCoverage: undefined })).toBeNull();
    expect(summarizeOpenHihat({ ...open, mode: 'RHYTHM' })).toBeNull();
    expect(summarizeOpenHihat({ ...open, notes: base.notes })).toBeNull();
  });
});
