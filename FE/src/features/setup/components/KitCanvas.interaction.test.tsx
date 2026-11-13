// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { kitShapes, makeCamera, padPoint, padShape } from '@/domain/kit/kitPerspective';
import { KitCanvas, type KitCanvasProps } from './KitCanvas';

const W = 720;
const H = 450;
const cam = makeCamera({ w: W, h: H });
const snare = DEFAULT_KIT_LAYOUT.SNARE;
// 스네어 윗면 중심(px). 원근 그림에서 스네어는 앞쪽이라 다른 패드에 가리지 않는다
const snareShape = kitShapes(DEFAULT_KIT_LAYOUT, cam).find((v) => v.pad === 'SNARE')!;
const sx = snareShape.cx;
const sy = snareShape.cy;

beforeEach(() => {
  // happy-dom에는 canvas 2D 컨텍스트가 없다. 그리기는 이 테스트의 관심사가 아니라 아무것도 안 하는 컨텍스트를 준다
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(extra: Partial<KitCanvasProps>) {
  const onTapPad = vi.fn();
  const onMovePad = vi.fn();
  const { container } = render(<KitCanvas layout={DEFAULT_KIT_LAYOUT} onTapPad={onTapPad} onMovePad={onMovePad} {...extra} />);
  return { wrap: container.querySelector('.kit-wrap') as HTMLElement, onTapPad, onMovePad };
}
const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1 });

describe('KitCanvas 끌기(kit-drag D6)', () => {
  it('draggable이고 슬롭을 넘게 움직이면 onMovePad만 부른다(옮긴 패드가 포인터를 따라온다)', () => {
    const { wrap, onTapPad, onMovePad } = setup({ draggable: true });
    // 중심에서 조금 벗어난 곳을 잡아도 잡은 지점 차이가 유지된다
    fireEvent.pointerDown(wrap, at(sx + 10, sy + 5));
    fireEvent.pointerMove(wrap, at(sx + 46, sy - 11));
    fireEvent.pointerUp(wrap, at(sx + 46, sy - 11));
    expect(onMovePad).toHaveBeenCalled();
    const [pad, x, y] = onMovePad.mock.calls.at(-1)!;
    expect(pad).toBe('SNARE');
    // 돌려받은 배치 좌표로 다시 그리면 패드 중심이 오른쪽 36·위 16px 옮겨진 자리에 있다(스네어는 아래 한계 가까이 있어 위로 옮긴다)
    const moved = padShape('SNARE', padPoint('SNARE', { x, y }), cam);
    expect(Math.hypot(moved.cx - (sx + 36), moved.cy - (sy - 16))).toBeLessThan(2);
    expect(x).toBeGreaterThan(snare.x);
    expect(onTapPad).not.toHaveBeenCalled();
  });

  it('슬롭 안에서 떼면 onTapPad만 부른다', () => {
    const { wrap, onTapPad, onMovePad } = setup({ draggable: true });
    fireEvent.pointerDown(wrap, at(sx, sy));
    fireEvent.pointerMove(wrap, at(sx + 3, sy + 2));
    fireEvent.pointerUp(wrap, at(sx + 3, sy + 2));
    expect(onTapPad).toHaveBeenCalledTimes(1);
    expect(onTapPad.mock.calls[0][0]).toBe('SNARE');
    expect(onMovePad).not.toHaveBeenCalled();
  });

  it('draggable이 아니면 움직여도 onMovePad를 부르지 않는다', () => {
    const { wrap, onMovePad } = setup({ draggable: false });
    fireEvent.pointerDown(wrap, at(sx, sy));
    fireEvent.pointerMove(wrap, at(sx + 60, sy + 20));
    fireEvent.pointerUp(wrap, at(sx + 60, sy + 20));
    expect(onMovePad).not.toHaveBeenCalled();
  });

  it('끌기 범위는 0.05~0.95로 잘린다', () => {
    const { wrap, onMovePad } = setup({ draggable: true });
    fireEvent.pointerDown(wrap, at(sx, sy));
    fireEvent.pointerMove(wrap, at(5000, -5000));
    const [, x, y] = onMovePad.mock.calls.at(-1)!;
    expect(x).toBeGreaterThanOrEqual(0.05);
    expect(x).toBeLessThanOrEqual(0.95);
    expect(y).toBeGreaterThanOrEqual(0.05);
    expect(y).toBeLessThanOrEqual(0.95);
  });
});

describe('KitCanvas 클릭 판정(원근 보기)', () => {
  it('패드 윗면 안쪽은 맞고 바깥 빈 자리는 빗나간다', () => {
    const { wrap, onTapPad } = setup({ draggable: false });
    fireEvent.pointerDown(wrap, at(sx + snareShape.rx * 0.9, sy));
    fireEvent.pointerUp(wrap, at(sx + snareShape.rx * 0.9, sy));
    expect(onTapPad).toHaveBeenCalledTimes(1);
    expect(onTapPad.mock.calls[0][0]).toBe('SNARE');
    onTapPad.mockClear();
    fireEvent.pointerDown(wrap, at(4, 4));
    fireEvent.pointerUp(wrap, at(4, 4));
    expect(onTapPad).not.toHaveBeenCalled();
  });

  it('넓은 판(1440×450)에서도 그림이 커지지 않는다(높이×1.6 기준)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1440, height: 450, right: 1440, bottom: 450, x: 0, y: 0, toJSON: () => ({}) });
    const wide = kitShapes(DEFAULT_KIT_LAYOUT, makeCamera({ w: 1440, h: 450 })).find((v) => v.pad === 'SNARE')!;
    expect(wide.rx).toBeCloseTo(snareShape.rx, 6);
    const { wrap, onTapPad } = setup({ draggable: false });
    fireEvent.pointerDown(wrap, at(wide.cx, wide.cy));
    fireEvent.pointerUp(wrap, at(wide.cx, wide.cy));
    expect(onTapPad.mock.calls[0][0]).toBe('SNARE');
  });
});

describe('KitCanvas 기준면 등록(포인터 모의 IMU)', () => {
  it('surfaceRef에 화면 → 자세 변환을 함께 넘기고, 패드 위에서는 그 패드의 배치 자세다', () => {
    const surfaceRef = vi.fn();
    setup({ surfaceRef });
    const [el, toPose] = surfaceRef.mock.calls[0];
    expect(el).toBeInstanceOf(HTMLElement);
    const pose = toPose(sx / W, sy / H);
    expect(pose.yaw).toBeCloseTo((snare.x - 0.5) * 120, 3);
    expect(pose.pitch).toBeCloseTo(-(snare.y - 0.5) * 70, 3);
  });
});

describe('KitCanvas 드럼 그림(보정 화면과 같은 DrumKit)', () => {
  it('하이햇 페달까지 9패드를 스킨 그림으로 그리고, 선택 패드에 선택 링을 그린다', () => {
    const { wrap } = setup({ highlightPad: 'SNARE' });
    expect(wrap.querySelectorAll('.drum-kit .drum-pad').length).toBe(9);
    expect(wrap.querySelector('[data-selected-pad="SNARE"]')).not.toBeNull();
    // 실물 스킨은 data-skin이 없다
    expect(wrap.querySelector('.drum-kit')?.getAttribute('data-skin')).toBeNull();
  });

  it('skin을 넘기면 그 스킨으로 그린다', () => {
    const { wrap } = setup({ skin: 'neon' });
    expect(wrap.querySelector('.drum-kit')?.getAttribute('data-skin')).toBe('neon');
    expect(wrap.querySelectorAll('.drum-pad[data-skin="neon"]').length).toBe(9);
  });
});
