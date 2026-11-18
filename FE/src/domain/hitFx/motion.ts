// 파티클의 시간 경과 계산(위치·크기·투명도·선 두께·번개 꺾임 단계). 상태 없이 나이(ms)만으로 정해진다.
import { rand01 } from './rand';
import type { FxParticle } from './types';

/** 픽셀 테마용 12fps 계단 간격(ms) */
export const STEP12_MS = 1000 / 12;
/** 번개가 다시 꺾이는 간격(ms) */
export const BOLT_STEP_MS = 40;

export interface FxSample {
  x: number;
  y: number;
  size: number;
  alpha: number;
  width: number;
  /** 번개 꺾임 단계(40ms마다 +1) */
  step: number;
  /** 조각 회전각(rad) */
  rot: number;
  /** 순간 속도(킷 좌표/초). 위치 식을 미분한 값 */
  vx: number;
  vy: number;
}

export function createSample(): FxSample {
  return { x: 0, y: 0, size: 0, alpha: 0, width: 0, step: 0, rot: 0, vx: 0, vy: 0 };
}

/**
 * 시작 지연을 뺀 나이(ms)에서 파티클 상태를 out에 채운다. 나이가 음수이거나 수명을 넘으면 false.
 * 위치는 속도·감속(drag)·가속의 닫힌 식이라 프레임 간격과 무관하다.
 */
export function sampleParticle(p: FxParticle, ageMs: number, out: FxSample): boolean {
  if (ageMs < 0 || ageMs >= p.lifeMs) return false;
  const tq = p.ease === 'step12' ? Math.floor(ageMs / STEP12_MS) * STEP12_MS : ageMs;
  const prog = tq / p.lifeMs;
  const e = p.ease === 'out' ? 1 - (1 - prog) * (1 - prog) : p.ease === 'expo' ? 1 - Math.pow(2, -10 * prog) : prog;
  const sec = tq / 1000;
  const dk = p.drag > 0 ? Math.exp(-p.drag * sec) : 1;
  const disp = p.drag > 0 ? (1 - dk) / p.drag : sec;
  out.x = p.x + p.vx * disp + 0.5 * p.ax * sec * sec;
  out.y = p.y + p.vy * disp + 0.5 * p.ay * sec * sec;
  out.size = p.size0 + (p.size1 - p.size0) * e;
  out.vx = p.vx * dk + p.ax * sec;
  out.vy = p.vy * dk + p.ay * sec;
  // hold: 수명의 hold 비율까지 alpha0 유지, 그 뒤 alpha1로 가속하며(p²) 간다
  const hold = p.hold ?? 0;
  const ae = hold > 0 ? (prog < hold ? 0 : ((prog - hold) / (1 - hold)) ** 2) : e;
  out.alpha = p.alpha0 + (p.alpha1 - p.alpha0) * ae;
  out.width = p.w0 + (p.w1 - p.w0) * e;
  out.step = Math.floor(ageMs / BOLT_STEP_MS);
  out.rot = (p.rot ?? 0) + (p.spin ?? 0) * sec;
  return true;
}

/**
 * 번개 꺾임: 기본 꼭짓점(base)의 각 구간을 SUB등분해 안쪽 점을 수직으로 흔든다. 양 끝은 그대로.
 * 같은 seed·step이면 같은 모양. 결과는 out에 쓰고 점 개수를 돌려준다(out은 호출자가 크기를 넉넉히 준비).
 */
export const BOLT_SUB = 4;
export function jagPath(base: readonly number[], seed: number, step: number, amp: number, out: Float64Array): number {
  const n = Math.floor(base.length / 2);
  if (n < 2) return 0;
  let w = 0;
  let idx = 0;
  const s = seed * 31 + step;
  out[w++] = base[0] as number;
  out[w++] = base[1] as number;
  for (let i = 0; i < n - 1; i++) {
    const ax = base[i * 2] as number;
    const ay = base[i * 2 + 1] as number;
    const bx = base[i * 2 + 2] as number;
    const by = base[i * 2 + 3] as number;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let j = 1; j <= BOLT_SUB; j++) {
      const f = j / BOLT_SUB;
      if (j === BOLT_SUB && i === n - 2) {
        out[w++] = bx;
        out[w++] = by;
      } else {
        const off = (rand01(s, idx++) - 0.5) * 2 * amp;
        out[w++] = ax + dx * f + nx * off;
        out[w++] = ay + dy * f + ny * off;
      }
    }
  }
  return w / 2;
}
