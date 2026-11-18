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
import { usePadHitSeq } from './usePadStates';

function fire(pad: PadId | null) {
  const hit = { id: 1, pad } as ResolvedHit;
  useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
}

describe('usePadHitSeq', () => {
  beforeEach(() => {
    h.cleanup?.();
    h.value = undefined;
    useLive.setState({ lastHit: null, hitSeq: 0 });
    usePadHitSeq();
  });

  it('타격마다 해당 패드 카운터가 1씩 오른다', () => {
    fire('SNARE');
    fire('SNARE');
    fire('KICK');
    expect(h.value).toEqual({ SNARE: 2, KICK: 1 });
  });

  it('하이햇 페달은 하이햇 패드에 센다', () => {
    fire('HIHAT_PEDAL');
    expect(h.value).toEqual({ HIHAT: 1 });
  });

  it('패드가 없는 타격과 hitSeq가 그대로인 갱신은 무시한다', () => {
    fire(null);
    useLive.setState({ audioReady: true });
    expect(h.value).toEqual({});
  });
});
