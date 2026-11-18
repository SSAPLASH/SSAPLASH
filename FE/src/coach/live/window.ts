// 최근 판정을 링 버퍼로 두고 코칭 지표를 계산한다. 문구 결정은 하지 않는다(rules·policy).
// 입력은 판정 한 건. 시계·DOM·저장소를 쓰지 않는 순수 로직이다.
import type { Judgement } from '@/domain/play/judgement';
import type { Pose } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
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
  /** 직전 시점(같은 시각 노트 묶음)의 패드들. 없으면 전환 원인을 계산하지 않는다(noteContext) */
  prevPads?: readonly PadId[];
  /** 직전 시점과의 간격(ms). 첫 노트는 null. 없으면 빠른 구간 원인을 계산하지 않는다 */
  prevGapMs?: number | null;
  /** 타격 순간 스틱 끝 방향(도). 센서 타격만. 구간 사실의 스틱 끝 방향(aim)에 쓴다 */
  pose?: Pose | null;
}

/** 채보 밖 타격 한 건. 시각은 곡 시각(ms) */
export interface StrayHit {
  pad: PadId;
  songTimeMs: number;
}

export interface PadStat {
  pad: PadId;
  count: number;
  meanDelta: number;
  /** 이 패드 타격 중 평균과 같은 부호인 비율. 평균이 0이면 0 */
  sameSignRatio: number;
}

/** 패드별 놓침. 노트 수는 그 패드의 판정 전체(MISS 포함)다 */
export interface PadMissStat {
  pad: PadId;
  misses: number;
  notes: number;
}

/** 세팅 안내에 쓰는 최근 setup.window개의 지표 */
export interface SetupStat {
  /** 창 안의 판정 수 */
  judged: number;
  validCount: number;
  meanDelta: number | null;
  stdDelta: number | null;
  sameSignRatio: number | null;
  misses: number;
  /** 창이 시작된 뒤 들어온 채보 밖 타격 수 */
  strayHits: number;
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
  /** 창(size개) 안의 MISS 개수 */
  missInWindow: number;
  /** 최근 missSize개 중 MISS 개수 */
  missInRecent: number;
  /** 끝에서부터 이어진 MISS 개수 */
  trailingMisses: number;
  /** 가장 최근 releaseWindow개 중 MISS 개수 */
  missInRelease: number;
  /** 창 안에서 유효 타격이 있는 패드별 통계 */
  pads: PadStat[];
  /** 최근 padMissSize개 중 전체 MISS 개수 */
  missInPadWindow: number;
  /** 최근 padMissSize개의 패드별 놓침 */
  padMisses: PadMissStat[];
  setup: SetupStat;
  /** 손별(0 = 왼손, 1 = 오른손) 평균 세기. handSize 창 기준 */
  hands: [HandStat, HandStat];
}

const { size, handSize, missSize, padMissSize } = LIVE_COACH_CONFIG.window;
const CAPACITY = Math.max(
  size,
  handSize,
  missSize,
  padMissSize,
  LIVE_COACH_CONFIG.setup.window,
  LIVE_COACH_CONFIG.miss.releaseWindow,
  LIVE_COACH_CONFIG.cause.window,
);

function isValid(n: JudgedNote): n is JudgedNote & { deltaMs: number } {
  return (n.judgement === 'PERFECT' || n.judgement === 'GOOD') && n.deltaMs !== null && Number.isFinite(n.deltaMs);
}

/** 유효 타격의 평균·표준편차·같은 부호 비율 */
function deltaStats(valid: readonly (JudgedNote & { deltaMs: number })[]): Pick<SetupStat, 'meanDelta' | 'stdDelta' | 'sameSignRatio'> {
  const n = valid.length;
  if (n === 0) return { meanDelta: null, stdDelta: null, sameSignRatio: null };
  const mean = valid.reduce((s, v) => s + v.deltaMs, 0) / n;
  const sign = Math.sign(mean);
  return {
    meanDelta: mean,
    stdDelta: Math.sqrt(valid.reduce((s, v) => s + (v.deltaMs - mean) ** 2, 0) / n),
    sameSignRatio: sign === 0 ? 0 : valid.filter((v) => Math.sign(v.deltaMs) === sign).length / n,
  };
}

/** 원인 계산용으로 들고 있는 채보 밖 타격 수 */
const STRAY_CAPACITY = 32;

export class JudgedWindow {
  private buf: JudgedNote[] = [];
  private strayBuf: StrayHit[] = [];
  /** buf와 같은 순서로, 그 판정이 들어온 때까지의 채보 밖 타격 누적 */
  private strayTotals: number[] = [];
  private seen = 0;

  get total(): number {
    return this.seen;
  }

  /** strayTotal은 이 플레이에서 지금까지 들어온 채보 밖 타격 수다 */
  push(n: JudgedNote, strayTotal = 0): void {
    this.buf.push(n);
    this.strayTotals.push(strayTotal);
    if (this.buf.length > CAPACITY) {
      this.buf.shift();
      this.strayTotals.shift();
    }
    this.seen += 1;
  }

  /** 채보 밖 타격을 기록한다. 개수 지표(strayTotal)와는 따로 원인 계산에만 쓴다 */
  pushStray(s: StrayHit): void {
    this.strayBuf.push(s);
    if (this.strayBuf.length > STRAY_CAPACITY) this.strayBuf.shift();
  }

  /** 최근 n개 판정(들어온 순서). 원인 계산은 노트 시각 순으로 다시 정렬해서 쓴다 */
  recent(n: number): JudgedNote[] {
    return this.buf.slice(-n);
  }

  /** 최근 채보 밖 타격 */
  strays(): readonly StrayHit[] {
    return this.strayBuf;
  }

  reset(): void {
    this.buf = [];
    this.strayBuf = [];
    this.strayTotals = [];
    this.seen = 0;
  }

  metrics(): WindowMetrics {
    const recent = this.buf.slice(-size);
    const valid = recent.filter(isValid);
    const n = valid.length;

    const { meanDelta, stdDelta, sameSignRatio } = deltaStats(valid);

    const setupRecent = this.buf.slice(-LIVE_COACH_CONFIG.setup.window);
    const setupValid = setupRecent.filter(isValid);
    const strays = this.strayTotals.slice(-LIVE_COACH_CONFIG.setup.window);
    const setup: SetupStat = {
      judged: setupRecent.length,
      validCount: setupValid.length,
      ...deltaStats(setupValid),
      misses: setupRecent.filter((v) => v.judgement === 'MISS').length,
      strayHits: strays.length === 0 ? 0 : strays[strays.length - 1] - strays[0],
    };

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
    const pads: PadStat[] = [...byPad].map(([pad, ds]) => {
      const mean = ds.reduce((s, d) => s + d, 0) / ds.length;
      const sign = Math.sign(mean);
      return {
        pad,
        count: ds.length,
        meanDelta: mean,
        sameSignRatio: sign === 0 ? 0 : ds.filter((d) => Math.sign(d) === sign).length / ds.length,
      };
    });

    const padRecent = this.buf.slice(-padMissSize);
    const missByPad = new Map<PadId, PadMissStat>();
    for (const v of padRecent) {
      const stat = missByPad.get(v.pad) ?? { pad: v.pad, misses: 0, notes: 0 };
      stat.notes += 1;
      if (v.judgement === 'MISS') stat.misses += 1;
      missByPad.set(v.pad, stat);
    }

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
      missInWindow: recent.filter((v) => v.judgement === 'MISS').length,
      missInRecent: missRecent.filter((v) => v.judgement === 'MISS').length,
      trailingMisses: trailing,
      missInRelease: releaseRecent.filter((v) => v.judgement === 'MISS').length,
      pads,
      missInPadWindow: padRecent.filter((v) => v.judgement === 'MISS').length,
      padMisses: [...missByPad.values()],
      setup,
      hands: [hand(0), hand(1)],
    };
  }
}
