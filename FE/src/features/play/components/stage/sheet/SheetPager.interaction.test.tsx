// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Chart } from '@/domain/song/chart';
import { gridTimeAt } from '@/domain/song/sheet';
import { xInBarContinuous } from '@/components/sheetmusic/sheetStripMath';
import { drawCursor, drawSheet } from '@/components/sheetmusic/sheetStripDraw';
import { SheetPager } from './SheetPager';
import { staffScale } from './sheetPagerMath';

vi.mock('@/components/sheetmusic/sheetStripDraw', async (load) => {
  const actual = await load<typeof import('@/components/sheetmusic/sheetStripDraw')>();
  return { ...actual, readColors: () => ({}), drawSheet: vi.fn(), drawCursor: vi.fn(), drawEmptyBar: vi.fn(), drawBeatLabel: vi.fn() };
});

const chart: Chart = {
  songId: 'test', title: 'test', difficulty: 'EASY', source: 'BUILTIN', bpm: 120, beatsPerBar: 4,
  offsetMs: 1000, durationMs: 12000, notes: [{ timeMs: 1000, pad: 'SNARE' }, { timeMs: 4250, pad: 'KICK' }],
  tempoSegments: [{ beat: 0, startMs: 1000, bpm: 120 }, { beat: 4, startMs: 3000, bpm: 240 }],
};
let time: number | null;
let nextFrame: FrameRequestCallback;
let reduced: boolean;
let width: number;
let resize: () => void;

beforeEach(() => {
  time = 1000; reduced = false; width = 640;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { nextFrame = fn; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { resize = fn; } observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, { get: () => () => {} }) as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const frame = () => nextFrame(0);
const cursor = () => vi.mocked(drawCursor).mock.lastCall![1];
const sheet = () => vi.mocked(drawSheet).mock.lastCall![1];

describe('SheetPager 프레임', () => {
  it('빠르기 변화·오프셋과 시킹, 리사이즈, 종료 후 null에서도 연속 화면을 유지한다', () => {
    render(<SheetPager chart={chart} noteStates={[]} strayHits={[]} getSongTime={() => time} countInMs={2000} />);
    time = 4250; frame();
    const opts = sheet();
    const g = gridTimeAt(chart, time);
    const bar = Math.floor(g / opts.barMs);
    const glyph = opts.layoutOf(bar).glyphs.find((n) => n.noteIndex === 1)!;
    const head = xInBarContinuous(opts.width * opts.baseRatio + bar * opts.barPx, opts.barPx, glyph.xRatio, 16);
    expect(cursor()).toBeCloseTo(head);
    expect(opts.continuousStepsPerBar).toBe(16);
    expect(vi.mocked(drawSheet)).toHaveBeenCalledTimes(2);
    width = 0; resize(); frame();
    expect(vi.mocked(drawSheet)).toHaveBeenCalledTimes(2);
    width = 1280; resize(); frame();
    // 높이 300 칸은 최대 배율 1.6으로 그리므로 논리 폭은 CSS 폭 ÷ 1.6이다
    expect(sheet().width).toBe(1280 / staffScale(300, 1280));
    time = chart.durationMs + 5000; frame();
    const endCursor = cursor(), endOrigin = sheet().baseRatio;
    time = null; frame();
    expect(cursor()).toBeCloseTo(endCursor);
    expect(sheet().baseRatio).toBeCloseTo(endOrigin);
    time = 1000; frame();
    expect(sheet().baseRatio).not.toBeCloseTo(endOrigin);
  });

  it('모션 줄이기는 기존 정적 페이지와 박 단위 커서를 유지한다', () => {
    reduced = true;
    render(<SheetPager chart={chart} noteStates={[]} strayHits={[]} getSongTime={() => time} />);
    time = 1120; frame();
    const first = cursor();
    time = 1499; frame();
    expect(cursor()).toBe(first);
    time = 1500; frame();
    expect(cursor()).toBeGreaterThan(first);
    expect(sheet().continuousStepsPerBar).toBeUndefined();
  });
});
