// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { useLive } from '@/store/liveStore';
import { StageBeam, StageFloor } from './StageLights';

const motionState = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motionState.reduce,
}));

let animate: ReturnType<typeof vi.fn>;
const original = HTMLElement.prototype.animate;

beforeEach(() => {
  animate = vi.fn();
  HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
  useLive.setState({ lastHit: null, hitSeq: 0 });
});
afterEach(() => {
  cleanup();
  HTMLElement.prototype.animate = original;
  motionState.reduce = false;
});

function fire(pad: PadId) {
  act(() => {
    useLive.setState((s) => ({ lastHit: { id: s.hitSeq + 1, pad, velocity: 100 } as ResolvedHit, hitSeq: s.hitSeq + 1 }));
  });
}

/** 움직임 줄이기 여부를 가장한다 */
function mockReduced(on: boolean) {
  motionState.reduce = on;
}

describe('StageBeam', () => {
  it('켜짐·꺼짐은 is-on 클래스(투명도 전환은 CSS)', () => {
    const { container, rerender } = render(<StageBeam on={false} />);
    expect(container.querySelector('.free-lights')?.classList.contains('is-on')).toBe(false);
    expect(container.querySelector('.free-lights')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<StageBeam on />);
    expect(container.querySelector('.free-lights')?.classList.contains('is-on')).toBe(true);
  });

  it('처음부터 켜진 채 들어오면 깜빡이지 않는다', () => {
    render(<StageBeam on />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('꺼짐 → 켜짐일 때만 1.1초 깜빡임, 켜짐 → 꺼짐은 깜빡이지 않는다', () => {
    const { rerender } = render(<StageBeam on={false} />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<StageBeam on />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 1100 });
    rerender(<StageBeam on={false} />);
    rerender(<StageBeam on={false} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('움직임 줄이기면 깜빡이지 않는다', () => {
    mockReduced(true);
    const { rerender } = render(<StageBeam on={false} />);
    rerender(<StageBeam on />);
    expect(animate).not.toHaveBeenCalled();
  });
});

describe('StageFloor', () => {
  it('킥 타격마다 0.5초 밝아짐, 다른 패드는 무시', () => {
    render(<StageFloor />);
    fire('SNARE');
    expect(animate).not.toHaveBeenCalled();
    fire('KICK');
    fire('KICK');
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 500 });
  });

  it('움직임 줄이기면 재생하지 않는다', () => {
    mockReduced(true);
    render(<StageFloor />);
    fire('KICK');
    expect(animate).not.toHaveBeenCalled();
  });

  it('animate가 없는 환경에서도 깨지지 않는다', () => {
    HTMLElement.prototype.animate = undefined as unknown as typeof HTMLElement.prototype.animate;
    render(<StageFloor />);
    expect(() => fire('KICK')).not.toThrow();
  });
});
