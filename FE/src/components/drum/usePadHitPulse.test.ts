import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadId } from '@/domain/kit/pads';
import type { ResolvedHit } from '@/domain/events';

// 테스트 환경이 node라 렌더러가 없다. useState·useEffect만 즉시 실행하는 최소 대역으로 바꾼다
const h = vi.hoisted(() => ({ value: undefined as unknown, cleanup: undefined as undefined | (() => void) }));
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  useState: (init: unknown) => {
    if (h.value === undefined) h.value = init;
    return [
      h.value,
      (u: unknown) => {
        h.value = typeof u === 'function' ? (u as (p: unknown) => unknown)(h.value) : u;
      },
    ];
  },
  useEffect: (fn: () => (() => void) | void) => {
    h.cleanup = fn() ?? undefined;
  },
}));

import { useLive } from '@/store/liveStore';
import { usePadHitPulse } from './usePadStates';

function fire(pad: PadId | null, velocity = 100) {
  const hit = { id: 1, pad, velocity } as ResolvedHit;
  useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
}

describe('usePadHitPulse', () => {
  beforeEach(() => {
    h.cleanup?.();
    h.value = undefined;
    useLive.setState({ lastHit: null, hitSeq: 0 });
    usePadHitPulse();
  });

  it('처음에는 null이다', () => {
    expect(h.value).toBeNull();
  });

  it('타격마다 패드·seq·세기를 담은 펄스를 낸다', () => {
    fire('SNARE', 90);
    expect(h.value).toEqual({ pad: 'SNARE', seq: 1, velocity: 90 });
    fire('KICK', 120);
    expect(h.value).toEqual({ pad: 'KICK', seq: 2, velocity: 120 });
  });

  it('하이햇 페달은 하이햇 패드로 옮긴다', () => {
    fire('HIHAT_PEDAL');
    expect((h.value as { pad: PadId }).pad).toBe('HIHAT');
  });

  it('패드가 없는 타격과 hitSeq가 그대로인 갱신은 무시한다', () => {
    fire(null);
    useLive.setState({ audioReady: true });
    expect(h.value).toBeNull();
  });
});
