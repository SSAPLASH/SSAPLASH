// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kitLayout';
import { KitCanvas, type KitCanvasProps } from './KitCanvas';

const W = 720;
const H = 320;
const snare = DEFAULT_KIT_LAYOUT.SNARE;
// 스네어 중심(px). 다른 패드와 겹치면 hitTest가 위쪽 패드를 잡으므로 스네어가 맨 위에 오는 위치를 쓴다
const sx = snare.x * W;
const sy = snare.y * H;

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
  it('draggable이고 슬롭을 넘게 움직이면 onMovePad만 부른다(잡은 지점 차이 유지)', () => {
    const { wrap, onTapPad, onMovePad } = setup({ draggable: true });
    fireEvent.pointerDown(wrap, at(sx, sy));
    fireEvent.pointerMove(wrap, at(sx + 36, sy + 16));
    fireEvent.pointerUp(wrap, at(sx + 36, sy + 16));
    expect(onMovePad).toHaveBeenCalled();
    const [pad, x, y] = onMovePad.mock.calls.at(-1)!;
    expect(pad).toBe('SNARE');
    expect(x).toBeCloseTo(snare.x + 0.05, 5);
    expect(y).toBeCloseTo(snare.y + 0.05, 5);
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
    expect(x).toBe(0.95);
    expect(y).toBe(0.05);
  });
});
