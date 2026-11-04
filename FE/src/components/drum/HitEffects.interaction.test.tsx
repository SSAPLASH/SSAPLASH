// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/pads';
import { useLive } from '@/store/liveStore';
import { DrumKit } from './DrumKit';
import { HitEffects } from './HitEffects';

afterEach(cleanup);
beforeEach(() => {
  // happy-dom은 Web Animations가 불완전해 실제 애니메이션을 돌리면 AbortError가 난다
  MotionGlobalConfig.skipAnimations = true;
  useLive.setState({ lastHit: null, hitSeq: 0 });
});

function fire(pad: PadId, velocity = 100) {
  act(() => {
    useLive.setState((s) => ({ lastHit: { id: s.hitSeq + 1, pad, velocity } as ResolvedHit, hitSeq: s.hitSeq + 1 }));
  });
}

function renderKit(skin: 'acoustic' | 'electronic' | 'neon' = 'acoustic') {
  return render(
    <LazyMotion features={domMax} strict>
      <DrumKit effects skin={skin} />
    </LazyMotion>,
  );
}

describe('HitEffects', () => {
  it('effects를 켜면 hit-effects 레이어가 있고 타격 전에는 비어 있다', () => {
    const { container } = renderKit();
    const layer = container.querySelector('g.hit-effects');
    expect(layer).not.toBeNull();
    expect(layer?.getAttribute('pointer-events')).toBe('none');
    expect(container.querySelectorAll('[data-effect]').length).toBe(0);
  });

  it('스네어를 치면 링 1개, 스파크는 없다', () => {
    const { container } = renderKit();
    fire('SNARE');
    expect(container.querySelectorAll('[data-effect-pad="SNARE"] [data-effect="ring"]').length).toBe(1);
    expect(container.querySelectorAll('[data-effect="spark"]').length).toBe(0);
  });

  it('심벌을 치면 링과 스파크 8개가 생긴다(전자 스킨도 같다)', () => {
    for (const skin of ['acoustic', 'electronic', 'neon'] as const) {
      const { container, unmount } = renderKit(skin);
      useLive.setState({ lastHit: null, hitSeq: 0 });
      fire('CRASH');
      expect(container.querySelectorAll('[data-effect-pad="CRASH"] [data-effect="ring"]').length).toBe(1);
      expect(container.querySelectorAll('[data-effect-pad="CRASH"] [data-effect="spark"]').length).toBe(8);
      unmount();
    }
  });

  it('하이햇 페달 타격은 하이햇 패드에 그린다', () => {
    const { container } = renderKit();
    fire('HIHAT_PEDAL');
    expect(container.querySelectorAll('[data-effect-pad="HIHAT"]').length).toBe(1);
  });

  it('같은 패드를 4번 연타해도 이펙트는 3개 이하다', () => {
    const { container } = renderKit();
    for (let i = 0; i < 4; i++) fire('KICK');
    expect(container.querySelectorAll('[data-effect-pad="KICK"] [data-effect="ring"]').length).toBeLessThanOrEqual(3);
    expect(container.querySelectorAll('[data-effect-pad="KICK"] [data-effect="ring"]').length).toBeGreaterThan(0);
  });

  it('링 중심은 패드 위치에서 나온다(전자 킥은 패드 중심 390,215)', () => {
    const { container } = render(
      <LazyMotion features={domMax} strict>
        <svg>
          <HitEffects skin="electronic" />
        </svg>
      </LazyMotion>,
    );
    fire('KICK');
    const ring = container.querySelector('[data-effect="ring"]');
    expect(Number(ring?.getAttribute('cx'))).toBeCloseTo(390);
    expect(Number(ring?.getAttribute('cy'))).toBeCloseTo(215);
  });
});
