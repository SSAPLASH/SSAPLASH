// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
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

// 패드별 진동 그룹: 그룹 안 패드의 data-shape·패드 순서로 찾기보다 data-shake 값만 모아 본다
const kitShake = (c: HTMLElement) => c.querySelector('g.kit-shake')?.getAttribute('data-shake') ?? null;
const shakes = (c: HTMLElement) => [...c.querySelectorAll('g.pad-shake')].map((g) => g.getAttribute('data-shake'));
const shakeOf = (c: HTMLElement, pad: PadId) => {
  const order = ['CRASH', 'RIDE', 'SMALL_TOM', 'MID_TOM', 'HIHAT', 'KICK', 'SNARE', 'FLOOR_TOM'];
  return shakes(c)[order.indexOf(pad)] ?? null;
};

function renderKit(effects: boolean) {
  return render(
    <LazyMotion features={domMax} strict>
      <DrumKit effects={effects} />
    </LazyMotion>,
  );
}

describe('진동감(E4): 킥은 킷 전체, 드럼은 친 패드만', () => {
  it('velocity 99는 흔들지 않고 100은 흔든다', () => {
    const { container } = renderKit(true);
    fire('KICK', 99);
    expect(kitShake(container)).toBeNull();
    fire('KICK', 100);
    // 킥은 킷 전체를 흔들고, 킥 패드 자체 그룹은 따로 흔들지 않는다
    expect(kitShake(container)).toBe('1');
    expect(shakeOf(container, 'KICK')).toBeNull();
    expect(shakeOf(container, 'SNARE')).toBeNull();
  });

  it('연타마다 다시 시작한다', () => {
    const { container } = renderKit(true);
    fire('KICK', 120);
    fire('KICK', 120);
    expect(kitShake(container)).toBe('2');
  });

  it('드럼 계열은 친 패드만 흔들고, 심벌은 흔들지 않는다(회전 흔들림이 따로 있다)', () => {
    const { container } = renderKit(true);
    fire('SNARE', 127);
    expect(shakeOf(container, 'SNARE')).toBe('1');
    // 스네어는 킷 전체를 흔들지 않는다
    expect(kitShake(container)).toBeNull();
    fire('CRASH', 127);
    expect(shakeOf(container, 'CRASH')).toBeNull();
  });

  it('effects가 꺼져 있으면 진동 그룹도 없다', () => {
    const { container } = renderKit(false);
    fire('KICK', 127);
    expect(container.querySelector('g.pad-shake')).toBeNull();
    expect(container.querySelector('g.kit-shake')).toBeNull();
  });
});
