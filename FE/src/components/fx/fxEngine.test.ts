import { describe, expect, it } from 'vitest';
import { HIT_FX_LAB_THEMES } from '@/domain/hitFx/themes';
import { celebrate } from '@/domain/hitFx/spawn/celebrate';
import type { FxEvent } from '@/domain/hitFx/types';
import { createFxEngine, MAX_PARTICLES } from './fxEngine';

/** 가짜 시계·rAF: 콜백을 잡아 두고 테스트가 직접 한 프레임씩 돌린다 */
function harness(opts: { maxParticles?: number } = {}) {
  let t = 0;
  let cb: (() => void) | null = null;
  let scheduled = 0;
  const engine = createFxEngine({
    ...opts,
    now: () => t,
    raf: (fn) => {
      cb = () => fn(t);
      scheduled++;
      return scheduled;
    },
    caf: () => {
      cb = null;
    },
  });
  return {
    engine,
    advance(ms: number) {
      t += ms;
    },
    frame() {
      const f = cb;
      cb = null;
      f?.();
    },
    get pending() {
      return cb !== null;
    },
    get scheduled() {
      return scheduled;
    },
  };
}

const ev = (seq: number, pad: FxEvent['pad'] = 'SNARE', velocity = 100): FxEvent => ({ seq, pad, velocity, mode: 'lab', judgement: null, deltaMs: null, combo: null });

describe('fxEngine', () => {
  it('처음에는 루프가 멈춰 있고 파티클 0', () => {
    const h = harness();
    expect(h.engine.stats()).toMatchObject({ alive: 0, running: false, dropped: 0 });
  });

  it('emit하면 루프가 시작되고, 모두 끝난 프레임에서 정지한다', () => {
    const h = harness();
    h.engine.emit(ev(1, 'SNARE'));
    expect(h.pending).toBe(true);
    expect(h.engine.stats().running).toBe(true);
    expect(h.engine.stats().alive).toBe(1);
    h.advance(200);
    h.frame();
    expect(h.engine.stats().alive).toBe(1);
    expect(h.pending).toBe(true);
    h.advance(300); // 링 450ms 경과
    h.frame();
    expect(h.engine.stats()).toMatchObject({ alive: 0, running: false });
    expect(h.pending).toBe(false);
  });

  it('연타해도 rAF는 하나만 예약한다', () => {
    const h = harness();
    for (let i = 1; i <= 5; i++) h.engine.emit(ev(i));
    expect(h.scheduled).toBe(1);
  });

  it('정지 후 다시 emit하면 다시 시작한다', () => {
    const h = harness();
    h.engine.emit(ev(1));
    h.advance(500);
    h.frame();
    expect(h.engine.stats().running).toBe(false);
    h.engine.emit(ev(2));
    expect(h.engine.stats().running).toBe(true);
  });

  it('전체 상한을 넘으면 오래된 것부터 버리고 버린 수를 센다', () => {
    const h = harness({ maxParticles: 10 });
    // 심벌 한 번에 링 1 + 스파크 8 = 9개
    h.engine.emit(ev(1, 'CRASH'));
    h.engine.emit(ev(2, 'CRASH'));
    const s = h.engine.stats();
    expect(s.alive).toBe(10);
    expect(s.dropped).toBe(8);
  });

  it('기본 상한은 200이고 스트레스에서도 넘지 않는다', () => {
    expect(MAX_PARTICLES).toBe(200);
    const h = harness();
    for (let i = 1; i <= 60; i++) h.engine.emit(ev(i, 'CRASH'));
    expect(h.engine.stats().alive).toBeLessThanOrEqual(200);
    expect(h.engine.stats().dropped).toBeGreaterThan(0);
  });

  it('오래된 것부터 버리므로 먼저 만든 것이 먼저 사라진다', () => {
    const h = harness({ maxParticles: 9 });
    h.engine.emit(ev(1, 'CRASH')); // 9개
    h.advance(100);
    h.engine.emit(ev(2, 'SNARE')); // +1 → 가장 오래된 1개 버림
    expect(h.engine.stats().alive).toBe(9);
    expect(h.engine.stats().dropped).toBe(1);
  });

  it('패드가 킷에 없으면(전자·네온의 HIHAT_PEDAL) 무시한다', () => {
    const h = harness();
    h.engine.setSkin('neon');
    h.engine.emit(ev(1, 'HIHAT_PEDAL'));
    expect(h.engine.stats().alive).toBe(0);
    expect(h.pending).toBe(false);
  });

  it('모션 줄이기면 덩어리 1개만, 테마·스킨은 다음 emit부터 적용', () => {
    const h = harness();
    h.engine.setReduced(true);
    h.engine.emit(ev(1, 'CRASH'));
    expect(h.engine.stats().alive).toBe(1);
    h.engine.setReduced(false);
    h.engine.setTheme('electric');
    h.engine.emit(ev(2, 'SNARE'));
    expect(h.engine.stats().alive).toBeGreaterThan(2);
    // 이미 떠 있던 것은 그대로
    expect(h.engine.stats().alive).toBeGreaterThan(1);
  });

  it('통계: 프레임 처리 시간·alive를 돌려준다', () => {
    const h = harness();
    h.engine.emit(ev(1));
    h.advance(16);
    h.frame();
    const s = h.engine.stats();
    expect(s.frameMsAvg).toBeGreaterThanOrEqual(0);
    expect(s.frameMsP95).toBeGreaterThanOrEqual(s.frameMsAvg);
    expect(s.fps).toBeGreaterThan(0);
  });

  it('캔버스가 없거나 2D 컨텍스트를 못 주면 조용히 아무것도 그리지 않는다', () => {
    const h = harness();
    const fake = { getContext: () => null } as unknown as HTMLCanvasElement;
    h.engine.attach(fake, { width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 });
    h.engine.emit(ev(1));
    h.advance(10);
    expect(() => h.frame()).not.toThrow();
    const throwing = { getContext: () => { throw new Error('x'); } } as unknown as HTMLCanvasElement;
    expect(() => h.engine.attach(throwing, { width: 1, height: 1, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 })).not.toThrow();
  });

  it('detach하면 풀을 비우고 루프를 멈춘다', () => {
    const h = harness();
    h.engine.emit(ev(1, 'CRASH'));
    h.engine.detach();
    expect(h.engine.stats()).toMatchObject({ alive: 0, running: false });
    expect(h.pending).toBe(false);
  });

  it('그리기 경로: 가짜 2D 컨텍스트로 모든 테마를 그려도 예외가 없고 가산 합성은 한 번만 전환한다', () => {
    const h = harness();
    let lighterSets = 0;
    const calls = { stroke: 0, fill: 0, image: 0 };
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
          return () => {
            if (k === 'stroke') calls.stroke++;
            if (k === 'fill') calls.fill++;
            if (k === 'drawImage') calls.image++;
          };
        },
        set: (_t, k, v) => {
          if (k === 'globalCompositeOperation' && v === 'lighter') lighterSets++;
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    h.engine.attach(canvas, { width: 800, height: 320, scale: 1, offsetX: 20, offsetY: 10, dpr: 1 });
    for (const theme of HIT_FX_LAB_THEMES) {
      h.engine.setTheme(theme);
      for (const pad of ['SNARE', 'CRASH', 'KICK'] as const) h.engine.emit(ev(10, pad));
    }
    h.advance(100);
    expect(() => h.frame()).not.toThrow();
    expect(lighterSets).toBe(1);
    expect(calls.stroke).toBeGreaterThan(0);
  });

  it('setMaxParticles: 상한을 낮추면 오래된 것부터 버리고 버린 수에 더한다, resetStats로 초기화', () => {
    const h = harness();
    for (let i = 0; i < 5; i++) h.engine.emit(ev(i, 'CRASH'));
    const before = h.engine.stats().alive;
    expect(before).toBeGreaterThan(20);
    h.engine.setMaxParticles(20);
    expect(h.engine.stats()).toMatchObject({ alive: 20, dropped: before - 20 });
    h.engine.emit(ev(9, 'CRASH'));
    expect(h.engine.stats().alive).toBe(20);
    h.engine.resetStats();
    expect(h.engine.stats().dropped).toBe(0);
  });

  it('setGlow(false): 발광 파티클도 그리기 오류 없이 평면 도형으로 그린다', () => {
    const h = harness();
    const noop = () => undefined;
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : noop), set: () => true }) as unknown as CanvasRenderingContext2D;
    h.engine.attach({ getContext: () => ctx } as unknown as HTMLCanvasElement, { width: 800, height: 320, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 });
    h.engine.setGlow(false);
    h.engine.setTheme('electric');
    h.engine.emit(ev(1));
    h.advance(50);
    expect(() => h.frame()).not.toThrow();
  });
});

describe('spawn(판정 밖 파티클 직접 넣기)', () => {
  it('넣은 파티클이 풀에 들어가고 상한을 넘으면 오래된 것부터 버린다', () => {
    const engine = createFxEngine({ maxParticles: 10, now: () => 0, raf: () => 1, caf: () => {} });
    engine.spawn(celebrate(1, 0, 0, ['#fff', '#000']));
    expect(engine.stats().alive).toBe(10);
    expect(engine.stats().dropped).toBe(5);
  });
});
