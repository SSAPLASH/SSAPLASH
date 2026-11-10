import { describe, expect, it } from 'vitest';
import { chartCoachContext } from './noteContext';

describe('chartCoachContext', () => {
  it('같은 시각 노트를 한 묶음으로 보고, 직전 묶음의 패드와 간격을 붙인다', () => {
    const ctx = chartCoachContext([
      { timeMs: 1000, pad: 'KICK' },
      { timeMs: 1000, pad: 'HIHAT' },
      { timeMs: 1250, pad: 'SNARE' },
      { timeMs: 1500, pad: 'SMALL_TOM' },
    ]);
    expect(ctx.notes[0]).toEqual({ prevPads: [], prevGapMs: null });
    expect(ctx.notes[1]).toEqual({ prevPads: [], prevGapMs: null });
    expect(ctx.notes[2]).toEqual({ prevPads: ['KICK', 'HIHAT'], prevGapMs: 250 });
    expect(ctx.notes[3]).toEqual({ prevPads: ['SNARE'], prevGapMs: 250 });
    expect(ctx.noteGapMedianMs).toBe(250);
  });

  it('노트가 시각 순이 아니어도 원래 순서로 돌려준다', () => {
    const ctx = chartCoachContext([
      { timeMs: 2000, pad: 'SNARE' },
      { timeMs: 1000, pad: 'SMALL_TOM' },
      { timeMs: 1500, pad: 'MID_TOM' },
    ]);
    expect(ctx.notes[0]).toEqual({ prevPads: ['MID_TOM'], prevGapMs: 500 });
    expect(ctx.notes[1].prevGapMs).toBeNull();
  });

  it('간격 중앙값은 묶음 사이 간격의 중앙값이고, 묶음이 하나면 null이다', () => {
    const ctx = chartCoachContext([
      { timeMs: 0, pad: 'SNARE' },
      { timeMs: 100, pad: 'SNARE' },
      { timeMs: 300, pad: 'SNARE' },
      { timeMs: 700, pad: 'SNARE' },
    ]);
    expect(ctx.noteGapMedianMs).toBe(200);
    expect(chartCoachContext([{ timeMs: 0, pad: 'SNARE' }]).noteGapMedianMs).toBeNull();
    expect(chartCoachContext([]).noteGapMedianMs).toBeNull();
  });
});
