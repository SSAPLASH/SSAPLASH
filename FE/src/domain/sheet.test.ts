import { describe, expect, it } from 'vitest';
import { buildSheet, positionAt } from './sheet';
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
    expect(m.bars[1].cells).toEqual([{ pad: 'HIHAT', step: 2, noteIndex: 3 }]);
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
});

describe('positionAt', () => {
  const m = buildSheet(chartOf([{ timeMs: 0, pad: 'KICK' }], 8000));

  it('마디 경계에서 다음 마디의 처음으로 넘어간다', () => {
    expect(positionAt(m, 0)).toEqual({ bar: 0, beat: 0, step: 0, fraction: 0 });
    expect(positionAt(m, 1999)).toMatchObject({ bar: 0, beat: 3, step: 15 });
    expect(positionAt(m, 2000)).toEqual({ bar: 1, beat: 0, step: 0, fraction: 0 });
  });

  it('박과 칸, 진행률을 계산한다', () => {
    const p = positionAt(m, 2000 + 500 + 130);
    expect(p).toMatchObject({ bar: 1, beat: 1, step: 5 });
    expect(p.fraction).toBeCloseTo(630 / 2000);
  });

  it('카운트인(음수 시각)은 이전 마디의 끝 박으로 센다', () => {
    expect(positionAt(m, -1)).toMatchObject({ bar: -1, beat: 3, step: 15 });
    expect(positionAt(m, -2000)).toMatchObject({ bar: -1, beat: 0, step: 0 });
  });
});
