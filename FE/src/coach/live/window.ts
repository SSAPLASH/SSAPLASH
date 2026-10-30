// 최근 판정을 링 버퍼로 두고 코칭 지표를 계산한다. 문구 결정은 하지 않는다(rules·policy).
// 입력은 판정 한 건. 시계·DOM·저장소를 쓰지 않는 순수 로직이다.
import type { Judgement } from '@/domain/judgement';
import type { PadId } from '@/domain/pads';
import { LIVE_COACH_CONFIG } from './config';

/** 판정 한 건. 손·세기는 MISS와 키보드 타격에서 null */
export interface JudgedNote {
  /** 판정 시점의 곡 시각(ms) */
  songTimeMs: number;
  /** 채보 노트 시각(ms) */
  noteTimeMs: number;
  judgement: Judgement;
  /** +면 늦음. MISS는 null */
  deltaMs: number | null;
  /** 노트 패드 */
  pad: PadId;
  stickId: 0 | 1 | null;
  /** 0~127. MISS는 null */
  velocity: number | null;
}

export interface PadStat {
  pad: PadId;
  count: number;
  meanDelta: number;
}

export interface HandStat {
  count: number;
  meanVelocity: number;
}

export interface WindowMetrics {
  /** 지금까지 받은 판정 수(창 크기와 무관한 누적) */
  total: number;
  /** 창 안의 유효 타격(PERFECT·GOOD) 수 */
  validCount: number;
  meanDelta: number | null;
  /** 평균과 같은 부호인 deltaMs의 비율. 평균이 0이면 0 */
  sameSignRatio: number | null;
  /** 모집단 표준편차 */
  stdDelta: number | null;
  /** 최근 missSize개 중 MISS 개수 */
  missInRecent: number;
  /** 끝에서부터 이어진 MISS 개수 */
  trailingMisses: number;
  /** 가장 최근 releaseWindow개 중 MISS 개수 */
  missInRelease: number;
  /** 창 안에서 유효 타격이 있는 패드별 통계 */
  pads: PadStat[];
  /** 손별(0 = 왼손, 1 = 오른손) 평균 세기. handSize 창 기준 */
  hands: [HandStat, HandStat];
}

const { size, handSize, missSize } = LIVE_COACH_CONFIG.window;
const CAPACITY = Math.max(size, handSize, missSize, LIVE_COACH_CONFIG.miss.releaseWindow);

function isValid(n: JudgedNote): n is JudgedNote & { deltaMs: number } {
  return (n.judgement === 'PERFECT' || n.judgement === 'GOOD') && n.deltaMs !== null && Number.isFinite(n.deltaMs);
}

export class JudgedWindow {
  private buf: JudgedNote[] = [];
  private seen = 0;

  get total(): number {
    return this.seen;
  }

  push(n: JudgedNote): void {
    this.buf.push(n);
    if (this.buf.length > CAPACITY) this.buf.shift();
    this.seen += 1;
  }

  reset(): void {
    this.buf = [];
    this.seen = 0;
  }

  metrics(): WindowMetrics {
    const recent = this.buf.slice(-size);
    const valid = recent.filter(isValid);
    const n = valid.length;

    let meanDelta: number | null = null;
    let sameSignRatio: number | null = null;
    let stdDelta: number | null = null;
    if (n > 0) {
      const mean = valid.reduce((s, v) => s + v.deltaMs, 0) / n;
      meanDelta = mean;
      stdDelta = Math.sqrt(valid.reduce((s, v) => s + (v.deltaMs - mean) ** 2, 0) / n);
      const sign = Math.sign(mean);
      sameSignRatio = sign === 0 ? 0 : valid.filter((v) => Math.sign(v.deltaMs) === sign).length / n;
    }

    const missRecent = this.buf.slice(-missSize);
    const releaseRecent = this.buf.slice(-LIVE_COACH_CONFIG.miss.releaseWindow);
    let trailing = 0;
    for (let i = this.buf.length - 1; i >= 0 && this.buf[i].judgement === 'MISS'; i--) trailing++;

    const byPad = new Map<PadId, number[]>();
    for (const v of valid) {
      const list = byPad.get(v.pad);
      if (list) list.push(v.deltaMs);
      else byPad.set(v.pad, [v.deltaMs]);
    }
    const pads: PadStat[] = [...byPad].map(([pad, ds]) => ({
      pad,
      count: ds.length,
      meanDelta: ds.reduce((s, d) => s + d, 0) / ds.length,
    }));

    const handSums: [number, number] = [0, 0];
    const handCounts: [number, number] = [0, 0];
    for (const v of this.buf.slice(-handSize)) {
      if (!isValid(v) || (v.stickId !== 0 && v.stickId !== 1) || v.velocity === null || !Number.isFinite(v.velocity)) continue;
      handSums[v.stickId] += v.velocity;
      handCounts[v.stickId] += 1;
    }
    const hand = (i: 0 | 1): HandStat => ({
      count: handCounts[i],
      meanVelocity: handCounts[i] === 0 ? 0 : handSums[i] / handCounts[i],
    });

    return {
      total: this.seen,
      validCount: n,
      meanDelta,
      sameSignRatio,
      stdDelta,
      missInRecent: missRecent.filter((v) => v.judgement === 'MISS').length,
      trailingMisses: trailing,
      missInRelease: releaseRecent.filter((v) => v.judgement === 'MISS').length,
      pads,
      hands: [hand(0), hand(1)],
    };
  }
}
