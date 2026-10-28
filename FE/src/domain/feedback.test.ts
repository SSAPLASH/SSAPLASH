import { describe, expect, it } from 'vitest';
import { buildFeedback, chartFromLog, summarizeByPad } from './feedback';
import type { Chart } from './chart';
import type { Judgement } from './judgement';
import type { PadId } from './pads';
import type { PlayLog } from '@/engine/playLog';

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
    const ns = [
      ...many(16, (i) => perfect(Math.floor(i / 4))), // 0~3마디 전부 PERFECT
      ...many(8, (i) => good(4 + Math.floor(i / 2), 'KICK', 0)), // 4~7마디 60%
    ];
    const f = buildFeedback(logOf(ns), chart);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: 'segment', title: '5~8마디에서 흔들려요', bars: [4, 7] });
  });

  it('규칙 3: SHEET 로그의 bpm·beatsPerBar로 마디 규칙이 돈다(ResultPage 경로)', () => {
    const ns = [...many(16, (i) => perfect(Math.floor(i / 4))), ...many(8, (i) => good(4 + Math.floor(i / 2), 'KICK', 0))];
    const log = logOf(ns);
    const f = buildFeedback(log, { bpm: log.bpm, beatsPerBar: log.beatsPerBar });
    expect(f[0]).toMatchObject({ id: 'segment', bars: [4, 7] });
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

  it('규칙 4: goodMs 50이면 표준편차 26ms는 걸리고 24ms는 안 걸린다', () => {
    const jitterOf = (d: number) =>
      buildFeedback(logOf([-d, d, -d, d, -d, d].map((x, i) => good(i % 4, 'HIHAT', x)), 0, 50), chart).some(
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
    expect(s[1]).toEqual({ pad: 'KICK', total: 3, perfect: 1, good: 1, miss: 1, meanDeltaMs: 20 });
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
});
