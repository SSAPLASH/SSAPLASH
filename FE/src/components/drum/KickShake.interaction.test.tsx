// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/pads';
import { useLive } from '@/store/liveStore';
import { DrumKit } from './DrumKit';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  useLive.setState({ lastHit: null, hitSeq: 0 });
});

function fire(pad: PadId, velocity: number) {
  act(() => {
    useLive.setState((s) => ({ lastHit: { id: s.hitSeq + 1, pad, velocity } as ResolvedHit, hitSeq: s.hitSeq + 1 }));
  });
}

const shakeOf = (c: HTMLElement) => c.querySelector('g.kit-shake')?.getAttribute('data-shake') ?? null;

function renderKit(effects: boolean) {
  return render(
    <LazyMotion features={domMax} strict>
      <DrumKit effects={effects} />
    </LazyMotion>,
  );
}

describe('킥 진동감(E4)', () => {
  it('velocity 99는 흔들지 않고 100은 흔든다', () => {
    const { container } = renderKit(true);
    fire('KICK', 99);
    expect(shakeOf(container)).toBeNull();
    fire('KICK', 100);
    expect(shakeOf(container)).toBe('1');
  });

  it('연타마다 다시 시작한다', () => {
    const { container } = renderKit(true);
    fire('KICK', 120);
    fire('KICK', 120);
    expect(shakeOf(container)).toBe('2');
  });

  it('킥이 아닌 패드는 세게 쳐도 흔들지 않는다', () => {
    const { container } = renderKit(true);
    fire('SNARE', 127);
    expect(shakeOf(container)).toBeNull();
  });

  it('effects가 꺼져 있으면 진동 그룹도 없다', () => {
    const { container } = renderKit(false);
    fire('KICK', 127);
    expect(container.querySelector('g.kit-shake')).toBeNull();
  });
});
