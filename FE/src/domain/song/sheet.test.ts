import { describe, expect, it } from 'vitest';
import { barCountOf, buildSheet, countLabel, gridOriginMs, gridTimeAt, gridTimeOf, layoutBar, songTimeAtGrid, stepIndexOf } from './sheet';
import { BUILTIN_CHARTS, CHART_8_FILL, CHART_BASIC_8, type Chart } from './chart';

function chartOf(notes: Chart['notes'], durationMs: number): Chart {
  return {
    songId: 't',
    title: 't',
    difficulty: 'EASY',
    bpm: 120, // 박 500ms, 마디 2000ms, 칸 125ms
    offsetMs: 0,
    beatsPerBar: 4,
    notes,
    source: 'BUILTIN',
    durationMs,
  };
}

describe('buildSheet', () => {
  it('가장 가까운 칸으로 양자화한다', () => {
    const m = buildSheet(
      chartOf(
        [
          { timeMs: 0, pad: 'KICK' },
          { timeMs: 60, pad: 'SNARE' }, // 0.48칸 → 0
          { timeMs: 70, pad: 'SNARE' }, // 0.56칸 → 1
          { timeMs: 2000 + 250, pad: 'HIHAT' }, // 다음 마디 2칸
        ],
        4000,
      ),
    );
    expect(m.bars[0].cells.map((c) => [c.pad, c.step])).toEqual([
      ['KICK', 0],
      ['SNARE', 0],
      ['SNARE', 1],
    ]);
    expect(m.bars[1].cells).toEqual([{ pad: 'HIHAT', step: 2, noteIndex: 3, offGrid: false }]);
    expect(m.stepMs).toBe(125);
  });

  it('행은 채보에 나오는 패드만 ALL_PADS 순서로', () => {
    const m = buildSheet(
      chartOf(
        [
          { timeMs: 0, pad: 'KICK' },
          { timeMs: 0, pad: 'CRASH' },
          { timeMs: 0, pad: 'SNARE' },
        ],
        2000,
      ),
    );
    expect(m.rows).toEqual(['CRASH', 'SNARE', 'KICK']);
  });

  it('마디 수는 ceil(durationMs / barMs)', () => {
    expect(buildSheet(chartOf([{ timeMs: 0, pad: 'KICK' }], 2000)).bars).toHaveLength(1);
    expect(buildSheet(chartOf([{ timeMs: 0, pad: 'KICK' }], 2001 + 1)).bars).toHaveLength(2);
    expect(buildSheet(chartOf([{ timeMs: 0, pad: 'KICK' }], 5000)).bars).toHaveLength(3);
  });

  it('내장 채보 3곡은 8마디이고 모든 노트가 칸에 배치된다', () => {
    for (const c of BUILTIN_CHARTS) {
      const m = buildSheet(c);
      expect(m.bars).toHaveLength(8);
      expect(m.bars.reduce((s, b) => s + b.cells.length, 0)).toBe(c.notes.length);
    }
    expect(buildSheet(CHART_BASIC_8).rows).toEqual(['HIHAT', 'SNARE', 'KICK']);
    expect(buildSheet(CHART_8_FILL).rows).toContain('CRASH');
  });

  it('offsetMs = 0이면 originMs 0, 내장 곡 노트는 모두 격자 위다', () => {
    for (const c of BUILTIN_CHARTS) {
      const m = buildSheet(c);
      expect(m.originMs).toBe(0);
      expect(m.bars.every((b) => b.cells.every((cell) => !cell.offGrid))).toBe(true);
    }
  });

  it('offsetMs > 0이면 offsetMs 시각이 1마디 1박, offsetMs + barMs가 2마디 1박이다', () => {
    const m = buildSheet({
      ...chartOf(
        [
          { timeMs: 1250, pad: 'KICK' }, // 1마디 1
          { timeMs: 1250 + 250, pad: 'HIHAT' }, // 1마디 1&(2칸)
          { timeMs: 1250 + 2000, pad: 'SNARE' }, // 2마디 1
        ],
        5250,
      ),
      offsetMs: 1250,
    });
    expect(m.originMs).toBe(1250);
    expect(m.bars[0].cells.map((c) => [c.pad, c.step, c.offGrid])).toEqual([
      ['KICK', 0, false],
      ['HIHAT', 2, false],
    ]);
    expect(m.bars[1].cells.map((c) => [c.pad, c.step, c.offGrid])).toEqual([['SNARE', 0, false]]);
    expect(m.bars).toHaveLength(2);
  });

  it('원점 앞 노트는 0마디 0칸에 모이고 offGrid다', () => {
    const m = buildSheet({ ...chartOf([{ timeMs: 900, pad: 'KICK' }], 3250), offsetMs: 1250 });
    expect(m.bars[0].cells).toEqual([{ pad: 'KICK', step: 0, noteIndex: 0, offGrid: true }]);
  });
});

describe('격자 시각 함수', () => {
  it('gridOriginMs는 offsetMs, 없으면 0', () => {
    expect(gridOriginMs({ offsetMs: 1250 })).toBe(1250);
    expect(gridOriginMs({})).toBe(0);
  });

  it('gridTimeOf는 원점을 뺀 값이고 리드인은 음수', () => {
    expect(gridTimeOf(1250, 1250)).toBe(0);
    expect(gridTimeOf(0, 1250)).toBe(-1250);
    expect(gridTimeOf(500, 0)).toBe(500);
  });

  it('stepIndexOf: 칸 중심에서 stepMs/4(31.25ms) 이내면 격자 위, 넘으면 offGrid', () => {
    // 칸 125ms, 허용 31.25ms
    expect(stepIndexOf(0, 0, 125)).toEqual({ idx: 0, offGrid: false });
    expect(stepIndexOf(125 + 31, 0, 125)).toEqual({ idx: 1, offGrid: false });
    expect(stepIndexOf(125 - 31, 0, 125)).toEqual({ idx: 1, offGrid: false });
    expect(stepIndexOf(125 + 32, 0, 125)).toEqual({ idx: 1, offGrid: true });
    expect(stepIndexOf(125 - 32, 0, 125)).toEqual({ idx: 1, offGrid: true });
    // 셋잇단 8분(박 500ms의 1/3 = 166.7ms → 1.33칸)은 걸린다
    expect(stepIndexOf(500 / 3, 0, 125)).toEqual({ idx: 1, offGrid: true });
  });

  it('stepIndexOf: 원점을 뺀 뒤 양자화하고 원점 앞은 0칸에 모은다', () => {
    expect(stepIndexOf(1250, 1250, 125)).toEqual({ idx: 0, offGrid: false });
    expect(stepIndexOf(1250 + 2000, 1250, 125)).toEqual({ idx: 16, offGrid: false });
    expect(stepIndexOf(1200, 1250, 125)).toEqual({ idx: 0, offGrid: true });
    expect(stepIndexOf(1250 - 125, 1250, 125)).toEqual({ idx: 0, offGrid: true });
  });

  it('stepIndexOf: 원점보다 stepMs/4 안에서 앞선 노트는 1박 타격(격자 위)', () => {
    expect(stepIndexOf(1250 - 10, 1250, 125)).toEqual({ idx: 0, offGrid: false });
    expect(stepIndexOf(1250 - 31, 1250, 125)).toEqual({ idx: 0, offGrid: false });
    expect(stepIndexOf(1250 - 32, 1250, 125)).toEqual({ idx: 0, offGrid: true });
  });

  it('barCountOf: offsetMs를 뺀 길이로 세고 마지막 노트 마디까지 포함한다', () => {
    const base = chartOf([{ timeMs: 0, pad: 'KICK' }], 4000);
    expect(barCountOf(base)).toBe(2);
    // 1250 + 2마디(4000) = 5250 → 2마디. offsetMs를 안 빼면 3마디가 돼 버린다
    expect(barCountOf({ ...base, offsetMs: 1250, durationMs: 5250, notes: [{ timeMs: 1250, pad: 'KICK' }] })).toBe(2);
    // 마지막 노트가 duration 뒤 3마디에 있으면 3마디
    expect(barCountOf({ ...base, offsetMs: 1250, durationMs: 5250, notes: [{ timeMs: 1250 + 4000, pad: 'KICK' }] })).toBe(3);
    // 반올림 여유: 2001ms는 1마디
    expect(barCountOf({ ...base, durationMs: 2001 })).toBe(1);
    expect(barCountOf({ ...base, offsetMs: 0, durationMs: 0, notes: [] })).toBe(1);
  });
});

describe('layoutBar', () => {
  // 120 BPM 4/4: 마디 2000ms, 칸 125ms
  const at = (step: number, bar = 0) => (bar * 16 + step) * 125;

  it('패드를 보표 위치·머리 모양으로 옮긴다 (스트립 문서 3-1 표)', () => {
    const pads = ['HIHAT_PEDAL', 'KICK', 'FLOOR_TOM', 'SNARE', 'MID_TOM', 'SMALL_TOM', 'RIDE', 'HIHAT', 'CRASH'] as const;
    const l = layoutBar(chartOf(pads.map((pad, i) => ({ timeMs: at(i), pad })), 2000), 0);
    expect(l.glyphs.map((g) => [g.pad, g.line, g.head])).toEqual([
      ['HIHAT_PEDAL', 0, 'cross'],
      ['KICK', 1, 'normal'],
      ['FLOOR_TOM', 3, 'normal'],
      ['SNARE', 5, 'normal'],
      ['MID_TOM', 6, 'normal'],
      ['SMALL_TOM', 7, 'normal'],
      ['RIDE', 8, 'cross'],
      ['HIHAT', 9, 'cross'],
      ['CRASH', 10, 'circle-cross'],
    ]);
    expect(l.glyphs.every((g) => g.stem)).toBe(true);
  });

  it('x 비율은 16분 격자로 양자화한 step/16이고 해당 마디 노트만 담는다', () => {
    const l = layoutBar(
      chartOf(
        [
          { timeMs: at(0), pad: 'KICK' },
          { timeMs: at(4) + 40, pad: 'SNARE' }, // 0.32칸 → 4
          { timeMs: at(8) - 50, pad: 'HIHAT' }, // 0.4칸 전 → 8
          { timeMs: at(2, 1), pad: 'HIHAT' }, // 다음 마디
        ],
        4000,
      ),
      0,
    );
    expect(l.glyphs.map((g) => [g.noteIndex, g.xRatio])).toEqual([
      [0, 0],
      [1, 0.25],
      [2, 0.5],
    ]);
    expect(layoutBar(chartOf([{ timeMs: at(2, 1), pad: 'HIHAT' }], 4000), 1).glyphs[0].xRatio).toBe(2 / 16);
  });

  it('한 박 안 16분 4개는 level 2 빔 하나로 묶는다', () => {
    const l = layoutBar(
      chartOf([0, 1, 2, 3].map((s) => ({ timeMs: at(s), pad: 'SNARE' as const })), 2000),
      0,
    );
    expect(l.beams).toEqual([{ glyphIndices: [0, 1, 2, 3], level: 2 }]);
  });

  it('8분 격자(박당 0·2칸)는 level 1, 박이 다르면 빔을 나눈다', () => {
    const l = layoutBar(
      chartOf([0, 2, 4, 6].map((s) => ({ timeMs: at(s), pad: 'HIHAT' as const })), 2000),
      0,
    );
    expect(l.beams).toEqual([
      { glyphIndices: [0, 1], level: 1 },
      { glyphIndices: [2, 3], level: 1 },
    ]);
  });

  it('같은 step의 여러 패드는 x가 같은 코드 음표다', () => {
    const l = layoutBar(
      chartOf(
        [
          { timeMs: at(0), pad: 'HIHAT' },
          { timeMs: at(0), pad: 'KICK' },
        ],
        2000,
      ),
      0,
    );
    expect(l.glyphs.map((g) => g.xRatio)).toEqual([0, 0]);
    expect(l.beams).toEqual([]); // step이 하나뿐이면 빔 없음
  });

  it('빈 마디는 빈 배열을 돌려준다', () => {
    const l = layoutBar(chartOf([{ timeMs: at(0), pad: 'KICK' }], 4000), 1);
    expect(l).toEqual({ bar: 1, glyphs: [], beams: [] });
  });

  it('offsetMs를 원점으로 배치하고 격자 밖 글리프에 offGrid를 단다', () => {
    const l = layoutBar(
      {
        ...chartOf(
          [
            { timeMs: 1250, pad: 'KICK' }, // 1마디 1
            { timeMs: 1250 + 500 + 40, pad: 'SNARE' }, // 2박 +40ms → 격자 밖
            { timeMs: 1250 + 2000, pad: 'HIHAT' }, // 2마디
          ],
          5250,
        ),
        offsetMs: 1250,
      },
      0,
    );
    expect(l.glyphs.map((g) => [g.noteIndex, g.xRatio, g.offGrid])).toEqual([
      [0, 0, false],
      [1, 0.25, true],
    ]);
    // offsetMs 없는 채보(이전 로그)는 0으로 본다
    expect(layoutBar({ bpm: 120, beatsPerBar: 4, notes: [{ timeMs: 250, pad: 'KICK' }] }, 0).glyphs[0].xRatio).toBe(2 / 16);
  });

  it('stepsPerBar를 바꾸면 3/4 같은 박자도 일반화된다', () => {
    const c: Chart = { ...chartOf([{ timeMs: 750, pad: 'KICK' }], 1500), beatsPerBar: 3 }; // 마디 1500ms, 칸 125ms
    expect(layoutBar(c, 0).glyphs[0].xRatio).toBe(6 / 12);
    expect(layoutBar(c, 0, { stepsPerBar: 6 }).glyphs[0].xRatio).toBe(3 / 6);
  });
});

describe('countLabel', () => {
  it('박 안 칸 위치 0/1/2/3을 박 번호·e·&·a로 바꾼다', () => {
    expect(countLabel(4, 16, 4)).toEqual({ beat: 2, sub: '' });
    expect(countLabel(5, 16, 4)).toEqual({ beat: 2, sub: 'e' });
    expect(countLabel(6, 16, 4)).toEqual({ beat: 2, sub: '&' });
    expect(countLabel(7, 16, 4)).toEqual({ beat: 2, sub: 'a' });
  });

  it('마디 처음과 끝', () => {
    expect(countLabel(0, 16, 4)).toEqual({ beat: 1, sub: '' });
    expect(countLabel(15, 16, 4)).toEqual({ beat: 4, sub: 'a' });
  });

  it('3/4박자(12칸)도 한 박 4칸이다', () => {
    expect(countLabel(8, 12, 3)).toEqual({ beat: 3, sub: '' });
    expect(countLabel(11, 12, 3)).toEqual({ beat: 3, sub: 'a' });
  });
});

it('열린 하이햇만 원 위치를 캐시하고 동시 크래시·빔도 유지한다', () => {
  const layout = layoutBar(chartOf([
    { timeMs: 0, pad: 'HIHAT', hihatOpen: true },
    { timeMs: 0, pad: 'CRASH', hihatOpen: true },
    { timeMs: 125, pad: 'HIHAT' },
  ], 2000), 0);
  expect(layout.glyphs.map((g) => g.openOffsetY)).toEqual([20, undefined, undefined]);
  expect(layout.glyphs[0].xRatio).toBe(layout.glyphs[1].xRatio);
  expect(layout.beams).toHaveLength(1);
});

// 빠르기 구간 (CHART-003-variable-tempo-exp): 120bpm으로 8박(2마디), 4000ms부터 60bpm
describe('빠르기 구간이 있는 곡의 격자', () => {
  const segs = [
    { beat: 0, startMs: 0, bpm: 120 },
    { beat: 8, startMs: 4000, bpm: 60 },
  ];
  const withSegs = (notes: Chart['notes'], durationMs: number): Chart => ({ ...chartOf(notes, durationMs), tempoSegments: segs });

  it('격자 시각은 박 번호 × 첫 빠르기 한 박이고 역함수가 맞다', () => {
    const c = withSegs([], 10_000);
    expect(gridTimeAt(c, 2000)).toBe(2000); // 4박
    expect(gridTimeAt(c, 5000)).toBe(4500); // 9박
    expect(songTimeAtGrid(c, 4500)).toBe(5000);
    expect(gridTimeAt(chartOf([], 10_000), 5000)).toBe(5000); // 구간 없으면 곡 시각 − 원점
  });

  it('노트는 구간 빠르기의 박에 놓인다', () => {
    // 5000ms = 9박 = 3마디(2번) 2박 = 칸 4. 고정 120bpm으로 셌다면 10박(3마디 3박)
    const sheet = buildSheet(withSegs([{ timeMs: 5000, pad: 'SNARE' }], 6000));
    expect(sheet.bars[2].cells).toEqual([{ pad: 'SNARE', step: 4, noteIndex: 0, offGrid: false }]);
    expect(layoutBar(withSegs([{ timeMs: 5000, pad: 'SNARE' }], 6000), 2).glyphs[0].xRatio).toBe(4 / 16);
  });

  it('마디 수는 격자 시각으로 센다', () => {
    // 곡 끝 8000ms = 12박 = 3마디
    expect(barCountOf(withSegs([], 8000))).toBe(3);
  });
});
