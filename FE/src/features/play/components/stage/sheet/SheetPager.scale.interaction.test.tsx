// @vitest-environment happy-dom
// SheetPager 악보 배율: 변환 행렬, 논리 크기, 이펙트 좌표(CSS 픽셀) 검사
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Chart } from '@/domain/song/chart';
import type { FxLocate } from '@/domain/hitFx/types';
import { xInBarContinuous } from '@/components/sheetmusic/sheetStripMath';
import { drawBeatLabel, drawSheet, HEAD_RX, headY } from '@/components/sheetmusic/sheetStripDraw';
import { SheetPager } from './SheetPager';
import { CONTENT_TOP, OVERLAY_RESERVE_PX, STAFF_SCALE_MAX, STAFF_SCALE_MIN, staffOffsetY, staffScale, staffScaleMax } from './sheetPagerMath';

vi.mock('@/components/sheetmusic/sheetStripDraw', async (load) => {
  const actual = await load<typeof import('@/components/sheetmusic/sheetStripDraw')>();
  return { ...actual, readColors: () => ({}), drawSheet: vi.fn(), drawCursor: vi.fn(), drawEmptyBar: vi.fn(), drawBeatLabel: vi.fn() };
});
let locate: FxLocate | undefined;
vi.mock('@/components/fx/FxCanvas', () => ({
  FxCanvas: (props: { locate: FxLocate }) => {
    locate = props.locate;
    return null;
  },
}));

const chart: Chart = {
  songId: 'test', title: 'test', difficulty: 'EASY', source: 'BUILTIN', bpm: 120, beatsPerBar: 4,
  offsetMs: 0, durationMs: 12000, notes: [{ timeMs: 0, pad: 'SNARE' }],
};
const DPR = 2;
let height: number;
let nextFrame: FrameRequestCallback;
const setTransform = vi.fn();

beforeEach(() => {
  height = 300;
  vi.stubGlobal('devicePixelRatio', DPR);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { nextFrame = fn; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy({}, { get: (_, name) => (name === 'setTransform' ? setTransform : () => {}) }) as CanvasRenderingContext2D,
  );
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); locate = undefined; });

const source = { subscribe: () => () => {} } as never;
const sheet = () => vi.mocked(drawSheet).mock.lastCall![1];

describe('SheetPager 악보 배율', () => {
  it('변환은 dpr × k이고 악보는 논리 크기(칸 ÷ k)로 그린다', () => {
    render(<SheetPager chart={chart} noteStates={[]} strayHits={[]} getSongTime={() => 0} />);
    nextFrame(0);
    // 칸 폭 1000이면 최대 배율이 1.6보다 크다(폭이 허락하는 만큼) — 높이 300이 그 최대에 닿는다
    const k = staffScale(300, 1000);
    expect(k).toBe(staffScaleMax(1000));
    expect(k).toBeGreaterThan(STAFF_SCALE_MAX);
    expect(setTransform).toHaveBeenLastCalledWith(DPR * k, 0, 0, DPR * k, 0, 0);
    expect(sheet().width).toBeCloseTo(1000 / k);
    expect(sheet().height).toBeCloseTo(300 / k);
  });

  it('칸이 낮으면 배율이 줄어들고 최소 1.2에서 멈춘다', () => {
    height = 100;
    render(<SheetPager chart={chart} noteStates={[]} strayHits={[]} getSongTime={() => 0} />);
    nextFrame(0);
    expect(setTransform).toHaveBeenLastCalledWith(DPR * STAFF_SCALE_MIN, 0, 0, DPR * STAFF_SCALE_MIN, 0, 0);
  });

  it('타이밍 막대(overlay)가 있으면 그 자리를 빼고 배율·세로 위치를 정한다: 박 번호가 막대에 깔리지 않는다', () => {
    height = 255;
    render(<SheetPager chart={chart} noteStates={[]} strayHits={[]} getSongTime={() => 0} overlay={<i />} />);
    nextFrame(0);
    const k = staffScale(255 - OVERLAY_RESERVE_PX, 1000);
    expect(setTransform).toHaveBeenLastCalledWith(DPR * k, 0, 0, DPR * k, 0, 0);
    // 박 번호 기준선이 막대 위 끝(칸 아래에서 OVERLAY_RESERVE_PX)보다 위다
    const label = vi.mocked(drawBeatLabel).mock.lastCall!;
    const offsetY = staffOffsetY(255 / k, OVERLAY_RESERVE_PX / k);
    expect((label[2] + offsetY) * k).toBeLessThanOrEqual(255 - OVERLAY_RESERVE_PX);
    // 위 끝도 칸 안이다
    expect((CONTENT_TOP + offsetY) * k).toBeGreaterThanOrEqual(-1e-9);
  });

  it('이펙트 위치는 확대된 음표 머리의 CSS 픽셀 좌표다', () => {
    render(<SheetPager chart={chart} noteStates={[null]} strayHits={[]} getSongTime={() => 0} fxSource={source} />);
    nextFrame(0);
    const k = staffScale(300, 1000);
    const opts = sheet();
    const glyph = opts.layoutOf(0).glyphs.find((g) => g.noteIndex === 0)!;
    // 논리 좌표의 머리 위치: 슬롯 왼쪽 x(= 논리 폭 × baseRatio)에서 연속 배치, y는 보표 위치에 세로 정렬 offset을 더한다
    const logicalX = xInBarContinuous(opts.width * opts.baseRatio, opts.barPx, glyph.xRatio, opts.continuousStepsPerBar!);
    const offsetY = staffOffsetY(opts.height);
    const loc = locate!({ judgement: 'PERFECT', noteIndex: 0 } as never)!;
    expect(loc.shape).toBe('head');
    expect(loc.geo.cx).toBeCloseTo(logicalX * k);
    expect(loc.geo.cy).toBeCloseTo((headY(glyph.line) + offsetY) * k);
    expect(loc.geo.rx).toBeCloseTo(HEAD_RX * 2 * k);
    expect(loc.geo.k).toBe(k);
  });
});
