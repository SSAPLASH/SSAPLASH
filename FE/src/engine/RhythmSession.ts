// MODE-01 리듬 게임 세션. 채보와 타격을 대조해 Perfect/Good/Miss를 낸다.
// 판정은 센서 타격 시각(tHit) 기준 — 통신·처리 지연과 무관 (공통 명세서 2-4).
import type { Chart, ChartNote } from '@/domain/song/chart';
import type { Pose, ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { JUDGEMENT_SCORE, judgeDelta, type Judgement, type TimingWindows } from '@/domain/play/judgement';
import { COUNTDOWN_MS } from '@/domain/time/leadIn';
import { gridOriginMs } from '@/domain/song/sheet';
import { isFootHit, isSensorSource } from '@/domain/events';
import { hitMatch, type MatchCandidate, type MatchRule } from './hitMatch';

export interface NoteState {
  index: number;
  note: ChartNote;
  judgement: Judgement | null;
  /** 타격 − 노트 (ms). +면 늦음 */
  deltaMs: number | null;
  hitId: number | null;
}

export type SessionStatus = 'idle' | 'countin' | 'playing' | 'paused' | 'finished';

export interface JudgementEvent {
  judgement: Judgement;
  deltaMs: number | null;
  pad: PadId;
  noteIndex: number;
  at: number;
  /** 타격한 손. MISS·키보드 타격은 null (키보드는 손 구분이 자리값이라 뜻이 없다) */
  stickId: 0 | 1 | null;
  /** 타격 세기 0~127. MISS·키보드 타격은 null */
  velocity: number | null;
  /** 타격 순간 스틱 끝 방향(도). 센서 타격만, MISS·키보드는 null. 연주 중 코칭의 스틱 끝 방향 사실에 쓴다 */
  pose: Pose | null;
}

/** 채보 밖 타격. 어느 패드를 언제 쳤는지 알린다(코칭의 다른 패드 놓침 판단용). 판정·점수와 무관하다 */
export interface StrayHitEvent {
  pad: PadId;
  /** 곡 시각(ms). 판정과 같은 기준(오디오 오프셋 반영) */
  songTimeMs: number;
  /**
   * 타격 − 가장 가까운 같은 패드 노트(ms). 아직 치지 않은 노트(미판정·MISS)만, 앞뒤 2 × goodMs 안에서 찾는다.
   * 없으면 null. 음수 빠름·양수 늦음. 타이밍 막대의 범위 밖 빨간 점에 쓴다(설계 MODE-003-timing-bar-miss-dot)
   */
  nearDeltaMs: number | null;
  /** 타격한 손과 스틱 끝 방향. 센서 타격만, 아니면 null(다른 패드로 잡힌 타격의 방향을 코칭에 쓴다) */
  stickId: 0 | 1 | null;
  pose: Pose | null;
}

export interface SessionSnapshot {
  status: SessionStatus;
  songTimeMs: number;
  score: number;
  maxScore: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  /** 채보에 없는 타격 (감점 없음, 리포트용) */
  strayHits: number;
  /** 후보 노트가 둘 이상이었던 타격 수 (매칭 경합) */
  contestedHits: number;
  last: JudgementEvent | null;
  judgedCount: number;
}

/** 후보 노트가 둘 이상이었던 타격(매칭 경합, G4)의 기록 */
export interface ContestedMatch {
  hitId: number;
  songTimeMs: number;
  pad: PadId;
  candidates: number[];
  picked: number;
  rule: MatchRule;
}

export interface RhythmOptions {
  windows: TimingWindows;
  countInBars: number;
  /** 오디오 출력 오프셋. 타격 시각에서 뺀다 */
  audioOffsetMs: number;
  /** 발 타격(하이햇 페달·킥)에 쓰는 오프셋. 이미 풀린 숫자(따로 재지 않았으면 audioOffsetMs와 같다) */
  kickOffsetMs: number;
}

export class RhythmSession {
  readonly chart: Chart;
  readonly notes: NoteState[];
  private opts: RhythmOptions;
  private startTime = 0; // 곡 0ms에 해당하는 performance.now()
  /** 오디오가 멈춘 동안 묶어 둔 곡 시각. 다음 retime·start·reset·pause·resume에서 비운다 */
  private heldSong: number | null = null;
  private status: SessionStatus = 'idle';
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private counts: Record<Judgement, number> = { PERFECT: 0, GOOD: 0, MISS: 0 };
  private strayHits = 0;
  private contestedHits = 0;
  private lastContested: ContestedMatch | null = null;
  private last: JudgementEvent | null = null;
  private judgedCount = 0;
  private cursor = 0; // 이 인덱스 이전 노트는 모두 판정됨
  private pausedAt = 0;
  private statusBeforePause: SessionStatus = 'playing';
  private judgementListeners = new Set<(e: JudgementEvent) => void>();
  private strayListeners = new Set<(e: StrayHitEvent) => void>();

  constructor(chart: Chart, opts: RhythmOptions) {
    this.chart = chart;
    this.opts = opts;
    this.notes = chart.notes.map((note, index) => ({ index, note, judgement: null, deltaMs: null, hitId: null }));
  }

  /** 가장 최근 경합 타격 기록. 진단 발행용(타격 id로 자기 것인지 확인한다) */
  get lastContestedMatch(): ContestedMatch | null {
    return this.lastContested;
  }

  get countInMs(): number {
    return (60_000 / this.chart.bpm) * this.chart.beatsPerBar * this.opts.countInBars;
  }

  /**
   * 리드인 전체 길이(ms) = 곡 시작 전 격자 음수 구간. 카운트다운이 켜져 있으면 카운트다운 3초 + 1마디 준비, 꺼져 있으면 0.
   * 클릭은 마지막 1마디(countInMs, 카운트다운이 끝난 뒤 준비 마디)에만 울린다 (설계 MODE-001-lead-in-bars D12·D17)
   */
  get preRollMs(): number {
    return this.opts.countInBars > 0 ? COUNTDOWN_MS + this.countInMs : 0;
  }

  get beatMs(): number {
    return 60_000 / this.chart.bpm;
  }

  /** 격자 원점(ms, 곡 시각 기준) = 1마디 1박. 카운트인은 여기서 끝난다 (MODE-003-sheet-grid-origin 3장) */
  get originMs(): number {
    return gridOriginMs(this.chart);
  }

  onJudgement(l: (e: JudgementEvent) => void): () => void {
    this.judgementListeners.add(l);
    return () => this.judgementListeners.delete(l);
  }

  /** 채보 밖 타격 알림. 알림만 하고 판정·개수는 바꾸지 않는다. 받는 쪽 오류는 세션에 전하지 않는다 */
  onStray(l: (e: StrayHitEvent) => void): () => void {
    this.strayListeners.add(l);
    return () => this.strayListeners.delete(l);
  }

  /** at: 곡 0ms(반주 0초)가 울리는 performance.now 시각. 리드인은 at + originMs − preRollMs부터 시작한다 */
  start(at: number): void {
    this.startTime = at;
    this.heldSong = null;
    this.status = this.opts.countInBars > 0 ? 'countin' : 'playing';
  }

  /** 처음 상태로 되돌린다(재시작용). 판정·점수·시계를 비우고 idle로 */
  reset(): void {
    this.status = 'idle';
    this.startTime = 0;
    this.heldSong = null;
    this.pausedAt = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { PERFECT: 0, GOOD: 0, MISS: 0 };
    this.strayHits = 0;
    this.contestedHits = 0;
    this.lastContested = null;
    this.last = null;
    this.judgedCount = 0;
    this.cursor = 0;
    for (const n of this.notes) {
      n.judgement = null;
      n.deltaMs = null;
      n.hitId = null;
    }
  }

  /** 카운트인 클릭 스케줄용: 각 박의 performance.now() 시각. 마지막 박 다음 박이 originMs(1마디 1박)다 */
  countInBeats(): { at: number; accent: boolean }[] {
    const out: { at: number; accent: boolean }[] = [];
    const beats = this.chart.beatsPerBar * this.opts.countInBars;
    for (let i = 0; i < beats; i++) {
      out.push({ at: this.startTime + this.originMs - this.countInMs + i * this.beatMs, accent: i % this.chart.beatsPerBar === 0 });
    }
    return out;
  }

  /** 곡 시각(ms). idle이면 리드인 시작 시점(−preRollMs)에 고정(준비 화면에서 노트를 멈춘 채 보여주기), 일시정지 중이면 멈춘 시각 */
  songTime(now: number = performance.now()): number {
    if (this.status === 'idle') return this.preRollMs > 0 ? -this.preRollMs : 0;
    if (this.status === 'paused') return this.pausedAt - this.startTime;
    if (this.heldSong !== null) return this.heldSong;
    return now - this.startTime;
  }

  /** 중단 확인 팝업 동안 시계를 멈춘다 (설계 4-2 중단 확인, U12). 플레이·카운트인에서만 */
  pause(now: number = performance.now()): void {
    if (this.status !== 'playing' && this.status !== 'countin') return;
    if (this.heldSong !== null) this.startTime = now - this.heldSong;
    this.heldSong = null;
    this.pausedAt = now;
    this.statusBeforePause = this.status;
    this.status = 'paused';
  }

  /**
   * 곡 0ms가 들리는 performance.now 시각을 바깥에서 다시 넣는다(설계 MODE-001 연주 시계를 오디오 시계 하나로).
   * 연주 시계가 들리는 오디오 시각으로 계산해 프레임마다 부른다. 플레이·카운트인에서만.
   * holdSongMs를 주면 다음 retime까지 곡 시각을 그 값에 묶는다(오디오가 멈춘 동안)
   */
  retime(startPerfMs: number, holdSongMs: number | null = null): void {
    if (this.status !== 'playing' && this.status !== 'countin') return;
    this.startTime = startPerfMs;
    this.heldSong = holdSongMs;
  }

  /** 멈춘 만큼 시작 시각을 밀어 곡 시각을 보존한 채 재개한다. 재개 카운트는 없다 */
  resume(now: number = performance.now()): void {
    if (this.status !== 'paused') return;
    this.startTime += now - this.pausedAt;
    this.status = this.statusBeforePause;
  }

  get currentStatus(): SessionStatus {
    return this.status;
  }

  /** 이 판에 적용 중인 판정 폭 */
  get windows(): TimingWindows {
    return this.opts.windows;
  }

  /** 판정에 적용 중인 오디오 출력 오프셋(ms) */
  get audioOffsetMs(): number {
    return this.opts.audioOffsetMs;
  }

  /** 발 타격에 적용 중인 오프셋(ms). 따로 재지 않았으면 audioOffsetMs와 같다 */
  get kickOffsetMs(): number {
    return this.opts.kickOffsetMs;
  }

  /** 타격 시각(performance.now) → 판정에 쓰는 곡 시각(ms). 발 타격이면 킥 오프셋, 아니면 스틱 오프셋을 뺀다 */
  hitSongTimeMs(tHit: number, foot = false): number {
    return tHit - (foot ? this.opts.kickOffsetMs : this.opts.audioOffsetMs) - this.startTime;
  }

  /** IMU 판정용 후보: 이 시각 근처에 칠 법한 패드들 */
  candidates(tHit: number): PadId[] | undefined {
    if (this.status !== 'playing' && this.status !== 'countin') return undefined;
    const t = this.hitSongTimeMs(tHit);
    const w = this.opts.windows.goodMs * 2;
    const set = new Set<PadId>();
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.note.timeMs > t + w) break;
      if (n.judgement === null && n.note.timeMs >= t - w) set.add(n.note.pad);
    }
    return set.size ? [...set] : undefined;
  }

  handleHit(hit: ResolvedHit): JudgementEvent | null {
    if (!hit.pad || (this.status !== 'playing' && this.status !== 'countin')) return null;
    const t = this.hitSongTimeMs(hit.tHit, isFootHit(hit));
    const w = this.opts.windows.goodMs;
    const cands: MatchCandidate[] = [];
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.note.timeMs > t + w) break;
      if (n.judgement !== null || n.note.pad !== hit.pad) continue;
      if (Math.abs(t - n.note.timeMs) <= w) cands.push({ index: i, timeMs: n.note.timeMs });
    }
    const m = hitMatch(cands, t, this.opts.windows);
    if (m.pick === null || m.rule === null) {
      this.strayHits += 1;
      const sensor = isSensorSource(hit.source);
      const stray: StrayHitEvent = {
        pad: hit.pad,
        songTimeMs: t,
        nearDeltaMs: this.nearMissDelta(hit.pad, t),
        stickId: sensor ? hit.stickId : null,
        pose: sensor ? poseOf(hit) : null,
      };
      for (const l of this.strayListeners) {
        try {
          l(stray);
        } catch {
          // 알림을 받는 쪽(코칭) 오류로 연주를 막지 않는다
        }
      }
      return null;
    }
    const best = this.notes[m.pick];
    const bestDelta = t - best.note.timeMs;
    if (m.contested) {
      this.contestedHits += 1;
      this.lastContested = {
        hitId: hit.id,
        songTimeMs: t,
        pad: hit.pad,
        candidates: cands.map((c) => c.index),
        picked: m.pick,
        rule: m.rule,
      };
    }
    const j = judgeDelta(bestDelta, this.opts.windows);
    return this.apply(best, j, bestDelta, hit.id, hit.tResolved, hit);
  }

  /** 채보 밖 타격 t에서 가장 가까운 같은 패드의 치지 않은 노트(미판정·MISS)까지의 차. 앞뒤 2 × goodMs 밖이면 null */
  private nearMissDelta(pad: PadId, t: number): number | null {
    const range = this.opts.windows.goodMs * 2;
    let best: number | null = null;
    // 노트는 시각순이다. 범위 시작까지 앞으로 물러난 뒤 범위 끝까지 훑는다
    let i = Math.max(0, Math.min(this.cursor, this.notes.length - 1));
    while (i > 0 && this.notes[i - 1].note.timeMs >= t - range) i--;
    for (; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.note.timeMs > t + range) break;
      if (n.note.pad !== pad || n.note.timeMs < t - range) continue;
      if (n.judgement === 'PERFECT' || n.judgement === 'GOOD') continue;
      const d = t - n.note.timeMs;
      if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    }
    return best;
  }

  private apply(n: NoteState, j: Judgement, delta: number | null, hitId: number | null, at: number, hit: ResolvedHit | null): JudgementEvent {
    n.judgement = j;
    n.deltaMs = delta;
    n.hitId = hitId;
    this.counts[j] += 1;
    this.judgedCount += 1;
    this.score += JUDGEMENT_SCORE[j];
    if (j === 'MISS') this.combo = 0;
    else {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
    while (this.cursor < this.notes.length && this.notes[this.cursor].judgement !== null) this.cursor++;
    // 손·세기는 센서 타격만 채운다(MISS는 hit 없음, 키보드는 값이 뜻 없음)
    const sensor = hit !== null && isSensorSource(hit.source);
    const ev: JudgementEvent = {
      judgement: j,
      deltaMs: delta,
      pad: n.note.pad,
      noteIndex: n.index,
      at,
      stickId: sensor ? hit.stickId : null,
      velocity: sensor ? hit.velocity : null,
      pose: sensor ? poseOf(hit) : null,
    };
    this.last = ev;
    for (const l of this.judgementListeners) l(ev);
    return ev;
  }

  /** 프레임마다 호출. 지나간 노트를 MISS 처리하고 종료를 감지 */
  tick(now: number = performance.now()): void {
    if (this.status === 'idle' || this.status === 'paused' || this.status === 'finished') return;
    const t = this.songTime(now);
    if (this.status === 'countin' && t >= 0) this.status = 'playing';
    const w = this.opts.windows.goodMs;
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.note.timeMs + w >= t) break;
      if (n.judgement === null) this.apply(n, 'MISS', null, null, now, null);
    }
    if (t > this.chart.durationMs + 800) this.status = 'finished';
  }

  snapshot(now: number = performance.now()): SessionSnapshot {
    return {
      status: this.status,
      songTimeMs: this.songTime(now),
      score: this.score,
      maxScore: this.notes.length * JUDGEMENT_SCORE.PERFECT,
      combo: this.combo,
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      strayHits: this.strayHits,
      contestedHits: this.contestedHits,
      last: this.last,
      judgedCount: this.judgedCount,
    };
  }
}

/** 타격의 스틱 끝 방향. 값이 없거나 숫자가 아니면 null(코칭이 방향을 쓰지 않는다. 판정에는 영향 없음) */
function poseOf(hit: ResolvedHit): Pose | null {
  const p = hit.pose;
  return p && Number.isFinite(p.pitch) && Number.isFinite(p.yaw) ? { pitch: p.pitch, yaw: p.yaw } : null;
}
