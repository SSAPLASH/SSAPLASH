// 판정·채점 이벤트 링과 집계. diagTap 이벤트를 받아 ④ 판정·⑤ 채점의 지표를 계산한다. 판정을 다시 계산하지 않는다.
// 타이머는 만들지 않는다 — stats() 호출 주기는 화면이 정한다. packetLog 행은 호출 때 넘겨받는다(HIT 패킷의 펌웨어 pad 대조용).
import type { DiagEvent, DiagSessionSummary } from '@/engine/diagTap';
import type { HitJudgedBy, ResolvedHit } from '@/domain/events';
import { JUDGEMENT_SCORE, type Judgement, type TimingWindows } from '@/domain/play/judgement';
import type { PadId } from '@/domain/kit/pads';
import type { LogRow } from './packetLog';
import { median } from '@/features/monitor/core/syncTrend';

/** 이벤트 링 크기 */
export const JUDGE_RING = 500;
/** delta 평균·표준편차 창(판정 수) */
export const DELTA_WINDOW = 50;
/** 세션 동안 모아 두는 delta 상한(히스토그램용) */
export const DELTA_KEEP = 5000;
/** 최근 판정 목록 보관 수 */
export const RECENT_KEEP = 50;
/** 펌웨어 pad 불일치·바운더리·pad null을 보는 최근 resolved 수 */
export const RESOLVE_WINDOW = 50;
/** 패드 판정 출처 비율을 보는 최근 resolved 수 */
export const JUDGED_BY_WINDOW = 200;
/** HIT 패킷 행과 ResolvedHit을 짝지을 때 수신 시각 차 허용(ms). u8 seq는 256건마다 돈다(설계 R4) */
export const SEQ_MATCH_MS = 2000;

export interface SessionInfo {
  mode: 'RHYTHM' | 'SHEET';
  songId: string;
  title: string;
  chartVersionId: number | null;
  windows: TimingWindows;
  audioOffsetMs: number;
  /** 발 타격에 적용된 값. 옛 녹화의 session 줄에는 없어 audioOffsetMs와 같다고 본다 */
  kickOffsetMs: number;
  noteCount: number;
  /** running 진행 중 / paused 일시정지 / ended 종료(값은 고정) */
  status: 'running' | 'paused' | 'ended';
  endReason: 'finished' | 'left' | null;
  startedAt: number;
}

/** 최근 판정 목록의 한 행 */
export interface RecentRow {
  t: number;
  /** judged: 노트와 매칭 / stray: 채보 밖 타격 / missed: 타격 없이 시간 초과 MISS */
  kind: 'judged' | 'stray' | 'missed';
  noteIndex: number | null;
  notePad: PadId | null;
  hitPad: PadId | null;
  deltaMs: number | null;
  judgement: Judgement | null;
  hitId: number | null;
  /** 스틱 HIT seq. 키보드·포인터는 null */
  seq: number | null;
  stick: 0 | 1 | null;
  songTimeMs: number;
}

export interface ResolveStats {
  /** 마지막 resolved 수신 시각. 없으면 null */
  lastT: number | null;
  /** 링에 있는 resolved 수 */
  total: number;
  /** 최근 JUDGED_BY_WINDOW건의 패드 판정 출처 건수 */
  judgedBy: Record<HitJudgedBy, number>;
  judgedByN: number;
  /** 펌웨어 pad ≠ FE 최종 pad (최근 RESOLVE_WINDOW건 중 HIT 패킷을 찾은 것만) */
  padMismatch: { compared: number; mismatched: number; pct: number | null };
  /** 바운더리 안 비율(inside가 있는 최근 RESOLVE_WINDOW건)·판정 거리 중앙값 */
  inside: { n: number; insideCount: number; pct: number | null; distanceMedian: number | null };
  /** 최근 RESOLVE_WINDOW건 중 패드 없음 */
  padNull: { n: number; window: number };
}

export interface ScoreStats {
  session: SessionInfo | null;
  /** 마지막 채점 이벤트(session·judged·missed) 수신 시각 */
  lastT: number | null;
  counts: Record<Judgement, number>;
  score: number;
  maxScore: number;
  combo: number;
  maxCombo: number;
  stray: number;
  judgedCount: number;
  /** 최근 DELTA_WINDOW 판정의 delta(ms, +늦음) */
  delta: { n: number; mean: number | null; std: number | null };
  /** 최근 판정 목록(최신이 앞) */
  recent: RecentRow[];
  /** 곡 시작 때 받은 노트 배열 */
  notes: { timeMs: number; pad: PadId }[] | null;
}

export interface JudgeStats {
  resolve: ResolveStats;
  score: ScoreStats;
}

/** 스틱 velocity(입력)와 FE velocity(출력) 쌍. ④ 세기 곡선 산점용 */
export interface VelocityPair {
  stick: 0 | 1;
  pad: PadId | null;
  seq: number;
  stickVelocity: number;
  feVelocity: number;
}

const zeroCounts = (): Record<Judgement, number> => ({ PERFECT: 0, GOOD: 0, MISS: 0 });

/** 평균·모표준편차. 비면 null */
export function meanStd(xs: readonly number[]): { mean: number | null; std: number | null } {
  if (xs.length === 0) return { mean: null, std: null };
  const mean = xs.reduce((a, v) => a + v, 0) / xs.length;
  const variance = xs.reduce((a, v) => a + (v - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(variance) };
}

/**
 * ResolvedHit의 seq·stick과 수신 시각이 맞는 수신 HIT 행(가장 가까운 것). 없으면 null.
 * rows는 오래된 → 최신 순서다.
 */
export function findHitRow(rows: readonly LogRow[], hit: ResolvedHit): LogRow | null {
  if (hit.seq === undefined) return null;
  let best: LogRow | null = null;
  let bestDiff = Infinity;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.t < hit.tRecv - SEQ_MATCH_MS) break;
    if (r.dir !== 'in' || r.decoded?.kind !== 'hit' || r.decoded.seq !== hit.seq) continue;
    if (r.stick !== null && r.stick !== hit.stickId) continue;
    const diff = Math.abs(r.t - hit.tRecv);
    if (diff <= SEQ_MATCH_MS && diff < bestDiff) {
      best = r;
      bestDiff = diff;
    }
  }
  return best;
}

export class JudgeLog {
  private ring: DiagEvent[] = [];
  private cap: number;
  private session: SessionInfo | null = null;
  private lastScoreT: number | null = null;
  private counts = zeroCounts();
  private stray = 0;
  private combo = 0;
  private maxCombo = 0;
  private deltas: number[] = [];
  private recent: RecentRow[] = [];
  private notes: { timeMs: number; pad: PadId }[] | null = null;

  constructor(cap = JUDGE_RING) {
    this.cap = cap;
  }

  /** 링의 이벤트(오래된 → 최신). resolved·judged·missed만 쌓는다 */
  events(): readonly DiagEvent[] {
    return this.ring;
  }

  clear(): void {
    this.ring = [];
    this.session = null;
    this.lastScoreT = null;
    this.notes = null;
    this.resetScore();
  }

  private resetScore(): void {
    this.counts = zeroCounts();
    this.stray = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.deltas = [];
    this.recent = [];
  }

  push(ev: DiagEvent): void {
    switch (ev.type) {
      case 'resolved':
        this.addRing(ev);
        return;
      case 'judged':
        this.addRing(ev);
        this.lastScoreT = ev.t;
        this.onJudged(ev);
        return;
      case 'missed':
        this.addRing(ev);
        this.lastScoreT = ev.t;
        this.count('MISS');
        this.addRecent({
          t: ev.t,
          kind: 'missed',
          noteIndex: ev.noteIndex,
          notePad: ev.pad,
          hitPad: null,
          deltaMs: null,
          judgement: 'MISS',
          hitId: null,
          seq: null,
          stick: null,
          songTimeMs: ev.songTimeMs,
        });
        return;
      case 'notes':
        this.notes = ev.notes;
        return;
      case 'session':
        this.onSession(ev);
        return;
    }
  }

  private addRing(ev: DiagEvent): void {
    this.ring.push(ev);
    if (this.ring.length > this.cap) this.ring.shift();
  }

  /** 링 뒤쪽에서 id가 같은 resolved. 판정 이벤트는 resolved 직후에 오므로 가까이에 있다 */
  private findResolved(id: number): ResolvedHit | null {
    for (let i = this.ring.length - 1, n = 0; i >= 0 && n < 100; i--, n++) {
      const e = this.ring[i];
      if (e.type === 'resolved' && e.hit.id === id) return e.hit;
    }
    return null;
  }

  /** 판정 하나를 카운트·콤보에 반영. MISS면 콤보 끊김 */
  private count(j: Judgement): void {
    this.counts[j] += 1;
    if (j === 'MISS') this.combo = 0;
    else {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
  }

  private addRecent(row: RecentRow): void {
    this.recent.push(row);
    if (this.recent.length > RECENT_KEEP) this.recent.shift();
  }

  private onJudged(ev: Extract<DiagEvent, { type: 'judged' }>): void {
    const hit = this.findResolved(ev.hitId);
    const base = {
      t: ev.t,
      noteIndex: ev.noteIndex,
      notePad: ev.notePad,
      hitPad: ev.hitPad,
      deltaMs: ev.deltaMs,
      judgement: ev.judgement,
      hitId: ev.hitId,
      seq: hit?.seq ?? null,
      stick: hit?.stickId ?? null,
      songTimeMs: ev.songTimeMs,
    };
    if (ev.judgement === null) {
      // 패드 없는 타격은 RhythmSession도 stray로 세지 않는다(handleHit이 먼저 반환). 같은 규칙으로 맞춘다
      if (ev.hitPad !== null) this.stray += 1;
      this.addRecent({ ...base, kind: 'stray' });
      return;
    }
    this.count(ev.judgement);
    if (ev.deltaMs !== null) {
      this.deltas.push(ev.deltaMs);
      if (this.deltas.length > DELTA_KEEP) this.deltas.shift();
    }
    this.addRecent({ ...base, kind: 'judged' });
  }

  private onSession(ev: Extract<DiagEvent, { type: 'session' }>): void {
    this.lastScoreT = ev.t;
    if (ev.phase === 'start') {
      this.resetScore();
      this.notes = null;
      this.session = { ...infoOf(ev), status: 'running', endReason: null, startedAt: ev.t };
      return;
    }
    if (!this.session) this.session = { ...infoOf(ev), status: 'running', endReason: null, startedAt: ev.t };
    if (ev.phase === 'pause') this.session.status = 'paused';
    else if (ev.phase === 'resume') this.session.status = 'running';
    else {
      this.session.status = 'ended';
      this.session.endReason = ev.reason ?? null;
      if (ev.summary) this.applySummary(ev.summary);
    }
  }

  /** 종료 스냅샷은 엔진이 센 값이라 derive한 값보다 우선한다 */
  private applySummary(s: DiagSessionSummary): void {
    this.counts = { ...s.counts };
    this.stray = s.strayHits;
    this.combo = s.combo;
    this.maxCombo = s.maxCombo;
  }

  stats(rows: readonly LogRow[]): JudgeStats {
    return { resolve: this.resolveStats(rows), score: this.scoreStats() };
  }

  private resolved(): ResolvedHit[] {
    const out: ResolvedHit[] = [];
    for (const e of this.ring) if (e.type === 'resolved') out.push(e.hit);
    return out;
  }

  private resolveStats(rows: readonly LogRow[]): ResolveStats {
    const all = this.resolved();
    const judgedBy: Record<HitJudgedBy, number> = { stick: 0, pose: 0, chart: 0, key: 0 };
    const byWin = all.slice(-JUDGED_BY_WINDOW);
    for (const h of byWin) judgedBy[h.judgedBy] += 1;

    const recent = all.slice(-RESOLVE_WINDOW);
    let compared = 0;
    let mismatched = 0;
    let insideN = 0;
    let insideCount = 0;
    const dists: number[] = [];
    let padNull = 0;
    for (const h of recent) {
      if (h.pad === null) padNull += 1;
      if (h.inside !== undefined) {
        insideN += 1;
        if (h.inside) insideCount += 1;
      }
      if (h.distanceDeg !== undefined) dists.push(h.distanceDeg);
      const row = findHitRow(rows, h);
      if (row && row.decoded?.kind === 'hit') {
        compared += 1;
        if (row.decoded.pad !== h.pad) mismatched += 1;
      }
    }
    return {
      lastT: this.lastOf('resolved'),
      total: all.length,
      judgedBy,
      judgedByN: byWin.length,
      padMismatch: { compared, mismatched, pct: compared === 0 ? null : (mismatched / compared) * 100 },
      inside: {
        n: insideN,
        insideCount,
        pct: insideN === 0 ? null : (insideCount / insideN) * 100,
        distanceMedian: median(dists),
      },
      padNull: { n: padNull, window: recent.length },
    };
  }

  private lastOf(type: 'resolved'): number | null {
    for (let i = this.ring.length - 1; i >= 0; i--) if (this.ring[i].type === type) return this.ring[i].t;
    return null;
  }

  private scoreStats(): ScoreStats {
    const recent = this.deltas.slice(-DELTA_WINDOW);
    const { mean, std } = meanStd(recent);
    const score = this.counts.PERFECT * JUDGEMENT_SCORE.PERFECT + this.counts.GOOD * JUDGEMENT_SCORE.GOOD;
    const n = this.session?.noteCount ?? 0;
    return {
      session: this.session ? { ...this.session } : null,
      lastT: this.lastScoreT,
      counts: { ...this.counts },
      score,
      maxScore: n * JUDGEMENT_SCORE.PERFECT,
      combo: this.combo,
      maxCombo: this.maxCombo,
      stray: this.stray,
      judgedCount: this.counts.PERFECT + this.counts.GOOD + this.counts.MISS,
      delta: { n: recent.length, mean, std },
      recent: this.recent.slice().reverse(),
      notes: this.notes,
    };
  }

  /** 이번 세션의 delta 전부(ms, 오래된 → 최신). 히스토그램용 */
  allDeltas(): readonly number[] {
    return this.deltas;
  }

  /** 최근 resolved 중 스틱 velocity(HIT 패킷)와 FE velocity(ResolvedHit) 쌍. HIT 패킷을 못 찾은 것은 뺀다 */
  velocityPairs(rows: readonly LogRow[], limit = 300): VelocityPair[] {
    const out: VelocityPair[] = [];
    const all = this.resolved();
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const h = all[i];
      // 손 없는 타격(페달)은 스틱 세기 비교 대상이 아니다
      if (h.stickId === null) continue;
      const row = findHitRow(rows, h);
      if (!row || row.decoded?.kind !== 'hit') continue;
      out.push({
        stick: h.stickId,
        pad: h.pad,
        seq: row.decoded.seq,
        stickVelocity: row.decoded.velocity,
        feVelocity: h.velocity,
      });
    }
    return out.reverse();
  }
}

function infoOf(ev: Extract<DiagEvent, { type: 'session' }>) {
  return {
    mode: ev.mode,
    songId: ev.songId,
    title: ev.title,
    chartVersionId: ev.chartVersionId,
    windows: ev.windows,
    audioOffsetMs: ev.audioOffsetMs,
    kickOffsetMs: ev.kickOffsetMs ?? ev.audioOffsetMs,
    noteCount: ev.noteCount,
  };
}
