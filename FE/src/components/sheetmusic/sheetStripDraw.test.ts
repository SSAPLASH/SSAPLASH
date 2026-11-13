import { describe, expect, it } from 'vitest';
import { layoutBar } from '@/domain/song/sheet';
import { xInBarContinuous } from './sheetStripMath';
import { drawSheet, type Colors } from './sheetStripDraw';

const colors: Colors = { ink: 'ink', inkDim: 'dim', inkFaint: 'faint', base: 'base', baseGlow: 'glow', warning: 'warning', judge: { PERFECT: 'perfect', GOOD: 'good', MISS: 'miss' } };
const chart = { bpm: 120, beatsPerBar: 4, notes: [{ timeMs: 0, pad: 'HIHAT' as const, hihatOpen: true as const }, { timeMs: 0, pad: 'CRASH' as const }, { timeMs: 125, pad: 'HIHAT' as const }] };
function painted(nowMs: number, expiry: number) {
  const arcs: { x: number; y: number; r: number; color: string; width: number }[] = [];
  const ctx = new Proxy({ strokeStyle: '', lineWidth: 0 }, {
    get(target, key) {
      if (key === 'arc') return (x: number, y: number, r: number) => arcs.push({ x, y, r, color: target.strokeStyle, width: target.lineWidth });
      if (key in target) return target[key as keyof typeof target];
      return () => {};
    },
    set(target, key, value) { Reflect.set(target, key, value); return true; },
  }) as unknown as CanvasRenderingContext2D;
  const layout = layoutBar(chart, 0);
  drawSheet(ctx, { chart, noteStates: ['PERFECT', null, null], strayHits: [], songTime: 0, originMs: 0, width: 320, height: 200, barPx: 320, baseRatio: 0, colors, layoutOf: () => layout, bars: { first: 0, last: 0 }, barMs: 2000, beatMs: 500, showBase: false, openWarnings: new Map([[0, expiry]]), nowMs });
  return { arcs, layout };
}
describe('열린 하이햇 그리기', () => {
  it('충돌을 피하는 배치를 캐시하고 400ms 경계에서 판정색으로 돌아간다', () => {
    const live = painted(1399, 1400), expired = painted(1400, 1400);
    expect(live.layout.glyphs[0].openOffsetY).toBe(20);
    expect(live.layout.glyphs[1].openOffsetY).toBeUndefined();
    expect(live.arcs.find((a) => a.r === 3)).toMatchObject({ y: 85, color: 'warning', width: 2.5 });
    expect(expired.arcs.find((a) => a.r === 3)).toMatchObject({ y: 85, color: 'perfect', width: 1.5 });
  });
});


it('연속 모드에서 음표 머리와 실제 타격 눈금을 같은 등간격 좌표에 그린다', () => {
  const marks: number[] = [];
  const heads: number[] = [];
  const ctx = new Proxy({}, {
    get(_target, key) {
      if (key === 'ellipse') return (x: number) => heads.push(x);
      if (key === 'fillRect') return (x: number, _y: number, width: number) => { if (width === 2) marks.push(x + 1); };
      return () => {};
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const c = { bpm: 120, beatsPerBar: 4, notes: [{ timeMs: 250, pad: 'SNARE' as const }] };
  drawSheet(ctx, { chart: c, noteStates: [null], strayHits: [], hitMarks: [{ timeMs: 250, judgement: 'PERFECT' }],
    songTime: 0, originMs: 0, width: 320, height: 200, barPx: 320, baseRatio: 0, colors,
    layoutOf: (bar) => layoutBar(c, bar), bars: { first: 0, last: 0 }, barMs: 2000, beatMs: 500,
    showBase: false, continuousStepsPerBar: 16 });
  const expected = xInBarContinuous(0, 320, 2 / 16, 16);
  expect(heads).toEqual([expected]);
  expect(marks).toEqual([expected]);
});
