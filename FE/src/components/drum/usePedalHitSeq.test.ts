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
import { usePedalHitSeq } from './usePedalHitSeq';

function fire(pad: PadId | null) {
  const hit = { id: 1, pad } as ResolvedHit;
  useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
}

describe('usePedalHitSeq', () => {
  beforeEach(() => {
    h.cleanup?.();
    h.value = undefined;
    useLive.setState({ lastHit: null, hitSeq: 0 });
    usePedalHitSeq();
  });

  it('하이햇 페달 타격마다 1씩 오른다', () => {
    fire('HIHAT_PEDAL');
    fire('HIHAT_PEDAL');
    expect(h.value).toBe(2);
  });

  it('다른 패드·패드 없는 타격은 세지 않는다(하이햇 패드도 아니다)', () => {
    fire('HIHAT');
    fire('SNARE');
    fire(null);
    expect(h.value).toBe(0);
  });

  it('정리하면 0으로 되돌린다', () => {
    fire('HIHAT_PEDAL');
    h.cleanup?.();
    expect(h.value).toBe(0);
  });
});
