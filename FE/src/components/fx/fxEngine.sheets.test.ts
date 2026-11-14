// 엔진의 연속 그림 연결: 준비 요청·해제, 준비 전 대체 경로, 한 타 상한, sheet 동시 재생 상한, 모션 줄이기.
import { describe, expect, it, vi } from 'vitest';
import type { FxSheetId, FxEvent, FxParticle } from '@/domain/hitFx/types';
import { particle } from '@/domain/hitFx/spawn/util';

// 물 테마의 spawn만 그림(sheet)을 내는 가짜로 바꾼다(실제 테마 구성은 테마별 테스트가 본다)
const fake = vi.hoisted(() => ({ sheetsPerHit: 1, dotsPerHit: 0, spawnCalls: 0, liteCalls: 0 }));
vi.mock('@/domain/hitFx/themes', async (orig) => {
  const m = await orig<typeof import('@/domain/hitFx/themes')>();
  return {
    ...m,
    hitFxThemeDef: (id: Parameters<typeof m.hitFxThemeDef>[0]) => {
      const d = m.hitFxThemeDef(id);
      if (id !== 'water') return d;
      const make = (): FxParticle[] => [
        ...Array.from({ length: fake.sheetsPerHit }, () => particle({ kind: 'sheet', sheet: 'water-front', x: 0, y: 0, size0: 100, lifeMs: 520, color: '#fff' })),
        ...Array.from({ length: fake.dotsPerHit }, () => particle({ kind: 'dot', x: 0, y: 0, color: '#fff', lifeMs: 100 })),
      ];
      return {
        ...d,
        spawn: () => {
          fake.spawnCalls++;
          return make();
        },
        spawnLite: (...a: Parameters<typeof d.spawnLite>) => {
          fake.liteCalls++;
          return d.spawnLite(...a);
        },
      };
    },
  };
});

const { createFxEngine, MAX_SHEETS } = await import('./fxEngine');
const { hitFxThemeDef } = await import('@/domain/hitFx/themes');

function fakeStore(ready: boolean) {
  const state = { ready };
  const use = vi.fn();
  return { state, use, store: { use, ready: vi.fn(() => state.ready), get: () => null } };
}

function make(ready: boolean) {
  const s = fakeStore(ready);
  let t = 0;
  const engine = createFxEngine({ sheets: s.store, now: () => t, raf: () => 1, caf: () => {} });
  engine.setTheme('water');
  return { ...s, engine, advance: (ms: number) => (t += ms) };
}

const ev = (seq: number, pad: FxEvent['pad'] = 'SNARE'): FxEvent => ({ seq, pad, velocity: 100, mode: 'lab', judgement: null, deltaMs: null, combo: null });

describe('fxEngine · 연속 그림 준비', () => {
  it('setTheme은 테마의 묶음 목록으로, detach는 빈 목록으로 use를 부른다', () => {
    const { engine, use } = make(true);
    expect(use).toHaveBeenLastCalledWith(engine, hitFxThemeDef('water').sheets);
    expect(hitFxThemeDef('water').sheets).toHaveLength(4);
    engine.setTheme('fire');
    expect(use).toHaveBeenLastCalledWith(engine, hitFxThemeDef('fire').sheets as readonly FxSheetId[]);
    engine.setTheme('auto');
    expect(use).toHaveBeenLastCalledWith(engine, []);
    engine.setTheme('water');
    engine.detach();
    expect(use).toHaveBeenLastCalledWith(engine, []);
  });

  it('attach는 현재 테마의 묶음을 다시 요청한다(detach 뒤 다시 붙는 경우)', () => {
    const { engine, use } = make(true);
    engine.detach();
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    engine.attach(canvas, { width: 1, height: 1, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 });
    expect(use).toHaveBeenLastCalledWith(engine, hitFxThemeDef('water').sheets);
  });
});

describe('fxEngine · 대체 경로', () => {
  it('보관소가 준비되지 않았으면 spawnLite 결과, 준비됐으면 spawn(sheet 포함) 결과가 들어간다', () => {
    fake.spawnCalls = fake.liteCalls = 0;
    fake.sheetsPerHit = 1;
    const a = make(false);
    a.engine.emit(ev(1));
    expect(fake.liteCalls).toBe(1);
    expect(fake.spawnCalls).toBe(0);
    const liteAlive = a.engine.stats().alive;
    expect(liteAlive).toBeGreaterThan(1);

    const b = make(true);
    b.engine.emit(ev(1));
    expect(fake.spawnCalls).toBe(1);
    expect(fake.liteCalls).toBe(1);
    expect(b.engine.stats().alive).toBe(1); // sheet 한 개
    // 준비 상태가 바뀌면 다음 타격부터 경로가 바뀐다
    b.state.ready = false;
    b.engine.emit(ev(2));
    expect(fake.liteCalls).toBe(2);
  });

  it('모션 줄이기면 준비돼 있어도 그림을 쓰지 않는다(덩어리 1개)', () => {
    fake.spawnCalls = 0;
    const { engine } = make(true);
    engine.setReduced(true);
    engine.emit(ev(1));
    expect(fake.spawnCalls).toBe(0);
    expect(engine.stats().alive).toBe(1);
  });
});

describe('fxEngine · 상한', () => {
  it('한 타는 판정 파티클 수 + 테마 maxSpawn까지(물 16)', () => {
    fake.sheetsPerHit = 1;
    fake.dotsPerHit = 30;
    const { engine } = make(true);
    engine.emit(ev(1));
    expect(engine.stats().alive).toBe(hitFxThemeDef('water').maxSpawn);
    expect(hitFxThemeDef('water').maxSpawn).toBe(16);
    // 판정이 있으면 그 수만큼 더 허용된다
    const judged = make(true);
    judged.engine.emit({ ...ev(2), judgement: 'PERFECT', deltaMs: 0, combo: 3 });
    expect(judged.engine.stats().alive).toBeGreaterThan(16);
    fake.dotsPerHit = 0;
  });

  it(`살아 있는 sheet가 ${MAX_SHEETS}개를 넘으면 가장 오래된 sheet부터 뺀다`, () => {
    fake.sheetsPerHit = 1;
    fake.dotsPerHit = 1;
    const { engine, advance } = make(true);
    for (let i = 1; i <= 14; i++) {
      engine.emit(ev(i));
      advance(10);
    }
    // sheet 12개 + 입자 14개(입자는 100ms 수명이라 아직 살아 있다)
    expect(engine.stats().alive).toBe(MAX_SHEETS + 14);
    expect(engine.stats().dropped).toBe(2);
    fake.dotsPerHit = 0;
  });

  it('전체 상한 200은 sheet와 별개로 계속 적용된다', () => {
    fake.sheetsPerHit = 1;
    fake.dotsPerHit = 15;
    const { engine } = make(true);
    for (let i = 1; i <= 30; i++) engine.emit(ev(i));
    expect(engine.stats().alive).toBeLessThanOrEqual(200);
    fake.dotsPerHit = 0;
  });
});
