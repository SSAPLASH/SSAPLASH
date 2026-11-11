// 구간 지연 분위수. resolved 이벤트의 t* 시각 차로 센서→수신, 수신→판정, 판정→오디오, 전체의 p50·p95를 낸다.
// ResolvedHit은 참조로 보관하고 stats() 때 읽는다 — 연주 화면은 tAudio를 resolved 발행 뒤에 채우기 때문이다.
import type { DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';

/** 최근 몇 건으로 분위수를 내는가 */
export const LATENCY_WINDOW = 200;

export interface Quantiles {
  /** 표본 수 */
  n: number;
  p50: number | null;
  p95: number | null;
}

export interface LatencyStats {
  /** 센서 → 수신 (tRecv − tHit) */
  recv: Quantiles;
  /** 수신 → 판정 (tResolved − tRecv) */
  resolve: Quantiles;
  /** 판정 → 오디오 예약 (tAudio − tResolved). tAudio가 있는 타격만 */
  audio: Quantiles;
  /** 센서 → 오디오 예약 (tAudio − tHit). tAudio가 있는 타격만 */
  total: Quantiles;
  /** 마지막 resolved 수신 시각. 없으면 null */
  lastT: number | null;
}

/** 시계열 한 점(시각 오름차순). 오디오가 없으면 audio는 null */
export interface LatencyPoint {
  t: number;
  recv: number;
  resolve: number;
  audio: number | null;
}

/** 선형 보간 분위수(q 0~1). 빈 배열이면 null */
export function percentile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const quantiles = (xs: number[]): Quantiles => ({ n: xs.length, p50: percentile(xs, 0.5), p95: percentile(xs, 0.95) });

export class LatencyStatsLog {
  private hits: { t: number; hit: ResolvedHit }[] = [];
  private cap: number;

  constructor(cap = LATENCY_WINDOW) {
    this.cap = cap;
  }

  clear(): void {
    this.hits = [];
  }

  /** diagTap 이벤트를 받는다. resolved만 쓴다 */
  push(ev: DiagEvent): void {
    if (ev.type !== 'resolved') return;
    this.hits.push({ t: ev.t, hit: ev.hit });
    if (this.hits.length > this.cap) this.hits.shift();
  }

  stats(): LatencyStats {
    const recv: number[] = [];
    const resolve: number[] = [];
    const audio: number[] = [];
    const total: number[] = [];
    for (const { hit: h } of this.hits) {
      recv.push(h.tRecv - h.tHit);
      resolve.push(h.tResolved - h.tRecv);
      if (h.tAudio !== undefined) {
        audio.push(h.tAudio - h.tResolved);
        total.push(h.tAudio - h.tHit);
      }
    }
    return {
      recv: quantiles(recv),
      resolve: quantiles(resolve),
      audio: quantiles(audio),
      total: quantiles(total),
      lastT: this.hits.length ? this.hits[this.hits.length - 1].t : null,
    };
  }

  series(): LatencyPoint[] {
    return this.hits.map(({ t, hit: h }) => ({
      t,
      recv: h.tRecv - h.tHit,
      resolve: h.tResolved - h.tRecv,
      audio: h.tAudio !== undefined ? h.tAudio - h.tResolved : null,
    }));
  }
}
