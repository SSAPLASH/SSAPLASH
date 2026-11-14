import { describe, expect, it } from 'vitest';
import { SHEET_DEFS } from '@/domain/hitFx/sheets';
import { particle } from '@/domain/hitFx/spawn/util';
import { drawFrame, type FxLive, type FxView } from './fxDraw';

const VIEW: FxView = { width: 800, height: 400, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };

/** 호출을 기록하는 가짜 2D 컨텍스트 */
function recorder() {
  const log: { fn: string; args: unknown[]; alpha: number }[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(
    {},
    {
      get: (_t, k: string) => {
        if (k in state) return state[k];
        if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
        return (...args: unknown[]) => log.push({ fn: k, args, alpha: state.globalAlpha as number });
      },
      set: (_t, k: string, v) => {
        state[k] = v;
        if (k === 'globalCompositeOperation') log.push({ fn: `op:${v}`, args: [], alpha: 0 });
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

const IMG = {} as CanvasImageSource;
const store = { get: () => IMG };

function sheetLive(over: Partial<ReturnType<typeof particle>> = {}, t0 = 0): FxLive {
  const def = SHEET_DEFS['water-side-a'];
  return {
    p: particle({ kind: 'sheet', sheet: 'water-side-a', x: 100, y: 200, size0: 200, alpha0: 0.8, alpha1: 0.8, color: '#fff', lifeMs: def.durMs, ease: 'linear', ...over }),
    t0,
    additive: true,
  };
}

describe('drawFrame · sheet', () => {
  it('앞·뒤 두 장을 섞어 그린다(원본 가장자리 0.5px 제외, 왼쪽 위 = (-w/2, -w·cy))', () => {
    const { ctx, log } = recorder();
    // 나이 320ms → u = 0.5^(1/1.5) × 23 ≈ 14.49, 앞 장 14, 뒤 장 15
    drawFrame(ctx, [sheetLive()], 320, VIEW, true, store);
    const imgs = log.filter((c) => c.fn === 'drawImage');
    expect(imgs).toHaveLength(2);
    const [a, b] = imgs as [(typeof imgs)[number], (typeof imgs)[number]];
    // 14번 장: 열 2, 행 2 → 256·2+0.5
    expect(a.args.slice(1, 5)).toEqual([2 * 256 + 0.5, 2 * 256 + 0.5, 255, 255]);
    expect(b.args.slice(1, 5)).toEqual([3 * 256 + 0.5, 2 * 256 + 0.5, 255, 255]);
    expect(a.args.slice(5)).toEqual([-100, -200 * SHEET_DEFS['water-side-a'].cy, 200, 200]);
    const u = Math.pow(0.5, 1 / 1.5) * 23;
    expect(a.alpha).toBeCloseTo(0.8 * (1 - (u - 14)));
    expect(b.alpha).toBeCloseTo(0.8 * (u - 14));
  });

  it('회전·뒤집기는 (x, y) 기준 변환으로 건다', () => {
    const { ctx, log } = recorder();
    drawFrame(ctx, [sheetLive({ rot: 0.03, mirror: true })], 100, VIEW, true, store);
    const fns = log.map((c) => c.fn);
    expect(fns).toContain('translate');
    expect(log.find((c) => c.fn === 'translate')!.args).toEqual([100, 200]);
    expect(log.find((c) => c.fn === 'rotate')!.args).toEqual([0.03]);
    expect(log.find((c) => c.fn === 'scale')!.args).toEqual([-1, 1]);
  });

  it('재생 속도는 lifeMs 비로 되돌려 반영한다(수명 짧음 = 빠른 재생)', () => {
    const fast = recorder();
    const slow = recorder();
    // 길이 640을 492ms에 재생(1.3배) → 나이 400 = 원래 시간 520
    drawFrame(fast.ctx, [sheetLive({ lifeMs: 640 / 1.3 })], 400, VIEW, true, store);
    drawFrame(slow.ctx, [sheetLive()], 520, VIEW, true, store);
    expect(fast.log.filter((c) => c.fn === 'drawImage').map((c) => c.args)).toEqual(slow.log.filter((c) => c.fn === 'drawImage').map((c) => c.args));
  });

  it('그림을 못 얻으면 그 파티클만 건너뛴다', () => {
    const { ctx, log } = recorder();
    const dot: FxLive = { p: particle({ kind: 'dot', x: 1, y: 1, color: '#fff', lifeMs: 100 }), t0: 0, additive: true };
    drawFrame(ctx, [sheetLive(), dot], 50, VIEW, true, { get: () => null });
    expect(log.some((c) => c.fn === 'drawImage')).toBe(false);
    expect(log.some((c) => c.fn === 'arc')).toBe(true);
    const none = recorder();
    expect(() => drawFrame(none.ctx, [sheetLive()], 50, VIEW)).not.toThrow();
  });

  it('수명이 끝났거나 시작 전이면 그리지 않는다', () => {
    const { ctx, log } = recorder();
    drawFrame(ctx, [sheetLive()], 700, VIEW, true, store);
    drawFrame(ctx, [sheetLive({ delayMs: 100 })], 50, VIEW, true, store);
    expect(log.some((c) => c.fn === 'drawImage')).toBe(false);
  });

  it('그리기 순서: 일반 합성 → 더하기(sheet 먼저, 나머지 나중), 더하기 전환은 한 번', () => {
    const { ctx, log } = recorder();
    const dot: FxLive = { p: particle({ kind: 'pixel', x: 1, y: 1, color: '#f00', lifeMs: 400, ease: 'linear' }), t0: 0, additive: true };
    const normal: FxLive = { p: particle({ kind: 'ring', x: 1, y: 1, rx: 5, ry: 5, w0: 2, w1: 2, color: '#0f0', lifeMs: 400, ease: 'linear' }), t0: 0, additive: false };
    // 풀 순서는 일부러 [입자, sheet, 일반]
    drawFrame(ctx, [dot, sheetLive(), normal], 100, VIEW, true, store);
    const seq = log.map((c) => c.fn).filter((f) => ['ellipse', 'drawImage', 'fillRect', 'op:lighter', 'op:source-over'].includes(f));
    expect(seq[0]).toBe('ellipse');
    expect(seq.indexOf('op:lighter')).toBeGreaterThan(0);
    expect(seq.indexOf('drawImage')).toBeLessThan(seq.indexOf('fillRect'));
    expect(seq.filter((f) => f === 'op:lighter')).toHaveLength(1);
  });
});

describe('drawFrame · drop', () => {
  it('속도 방향의 반대쪽으로 꼬리를 늘인다(길이 = 속도 × streak, 크기의 6배 이하)', () => {
    const { ctx, log } = recorder();
    const drop: FxLive = {
      p: particle({ kind: 'drop', x: 10, y: 10, vx: 1000, vy: 0, size0: 2, size1: 2, alpha0: 1, alpha1: 1, color: '#fff', lifeMs: 400, ease: 'linear', streak: 0.006 }),
      t0: 0,
      additive: true,
    };
    drawFrame(ctx, [drop], 0, VIEW);
    const line = log.find((c) => c.fn === 'lineTo')!;
    // 속도 1000 × 0.006 = 6, 크기 2의 6배 = 12 → 6. 꼬리는 -x 쪽
    expect(line.args[0]).toBeCloseTo(10 - 6);
    expect(line.args[1]).toBeCloseTo(10);
  });

  it('길이는 크기의 6배로 막힌다, 속도가 거의 없으면 점', () => {
    const a = recorder();
    const fast: FxLive = { p: particle({ kind: 'drop', x: 0, y: 0, vy: -100000, size0: 1, size1: 1, alpha0: 1, alpha1: 1, color: '#fff', lifeMs: 400, ease: 'linear' }), t0: 0, additive: true };
    drawFrame(a.ctx, [fast], 0, VIEW);
    expect((a.log.find((c) => c.fn === 'lineTo')!.args[1] as number)).toBeCloseTo(6);
    const b = recorder();
    const still: FxLive = { p: particle({ kind: 'drop', x: 5, y: 5, size0: 1, size1: 1, alpha0: 1, alpha1: 1, color: '#fff', lifeMs: 400, ease: 'linear' }), t0: 0, additive: true };
    drawFrame(b.ctx, [still], 0, VIEW);
    expect(b.log.find((c) => c.fn === 'lineTo')!.args).toEqual([5.01, 5]);
  });
});
