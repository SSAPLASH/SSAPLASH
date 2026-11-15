import { describe, expect, it } from 'vitest';
import { hitFxThemeDef } from '@/domain/hitFx/themes';
import type { FxEvent, FxLocate } from '@/domain/hitFx/types';
import { createFxEngine } from './fxEngine';

function make() {
  let t = 0;
  let cb: (() => void) | null = null;
  const engine = createFxEngine({
    now: () => t,
    raf: (fn) => {
      cb = () => fn(t);
      return 1;
    },
    caf: () => {
      cb = null;
    },
  });
  return {
    engine,
    advance: (ms: number) => (t += ms),
    frame() {
      const f = cb;
      cb = null;
      f?.();
    },
  };
}

const ev = (over: Partial<FxEvent> = {}): FxEvent => ({ seq: 3, pad: 'SNARE', velocity: 100, mode: 'game', judgement: null, deltaMs: null, combo: null, ...over });
const lane: FxLocate = (e) => (e.judgement ? { geo: { cx: 50, cy: 100, rx: 40, ry: 12, k: 1 }, shape: 'lane' } : null);

describe('fxEngine 판정 이펙트', () => {
  it('패드(기본 locate): PERFECT는 테마 이펙트 + 링, 비판정보다 파티클이 많다', () => {
    const a = make();
    a.engine.emit(ev());
    const b = make();
    b.engine.emit(ev({ judgement: 'PERFECT', deltaMs: 0 }));
    expect(b.engine.stats().alive).toBe(a.engine.stats().alive + 1);
  });

  it('패드: 헛침은 테마 이펙트 없이 회색 점 6개', () => {
    const h = make();
    h.engine.emit(ev({ stray: true }));
    expect(h.engine.stats().alive).toBe(6);
  });

  it('패드: MISS는 테마 이펙트를 내지 않는다(실제 화면은 MISS를 패드로 보내지 않는다)', () => {
    const h = make();
    h.engine.emit(ev({ judgement: 'MISS' }));
    // 랩 미리보기 파편 8개뿐 — 테마 파티클이 섞이지 않는다
    expect(h.engine.stats().alive).toBe(8);
  });

  it('한 이벤트 상한 = 판정 파티클(PERFECT 링 1) + 테마 maxSpawn: 테마가 많아도 넘지 않는다', () => {
    for (const theme of ['auto', 'electric', 'water', 'fire', 'ink', 'pixel'] as const) {
      const h = make();
      h.engine.setTheme(theme);
      h.engine.emit(ev({ pad: 'CRASH', velocity: 127, judgement: 'PERFECT', deltaMs: 0 }));
      expect(h.engine.stats().alive).toBeLessThanOrEqual(hitFxThemeDef(theme).maxSpawn + 1);
    }
  });

  it('locate가 null이면 아무것도 내지 않고 루프도 돌지 않는다', () => {
    const h = make();
    h.engine.setLocate(lane);
    h.engine.emit(ev()); // 판정 없음 → null
    expect(h.engine.stats()).toMatchObject({ alive: 0, running: false });
  });

  it('하이웨이 locate: 테마와 무관하게 판정 이펙트만(PERFECT 10개)', () => {
    for (const theme of ['auto', 'electric', 'fire'] as const) {
      const h = make();
      h.engine.setTheme(theme);
      h.engine.setLocate(lane);
      h.engine.emit(ev({ judgement: 'PERFECT', deltaMs: 0 }));
      expect(h.engine.stats().alive).toBe(10);
    }
  });

  it('하이웨이: 모든 파티클이 450ms 안에 끝나고 루프가 멈춘다', () => {
    const h = make();
    h.engine.setLocate(lane);
    h.engine.emit(ev({ judgement: 'PERFECT', deltaMs: 0 }));
    h.engine.emit(ev({ seq: 4, judgement: 'MISS' }));
    expect(h.engine.stats().running).toBe(true);
    h.advance(460);
    h.frame();
    expect(h.engine.stats()).toMatchObject({ alive: 0, running: false });
  });

  it('하이웨이: 모션 줄이기면 섬광·깨짐이 없다', () => {
    const h = make();
    h.engine.setLocate(lane);
    h.engine.setReduced(true);
    h.engine.emit(ev({ judgement: 'MISS' }));
    expect(h.engine.stats().alive).toBe(0);
  });

  it('setLocate(null)이면 다시 킷 좌표 패드 위치를 쓴다', () => {
    const h = make();
    h.engine.setLocate(lane);
    h.engine.setLocate(null);
    h.engine.emit(ev());
    expect(h.engine.stats().alive).toBe(1);
  });
});
