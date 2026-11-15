// 세션 시계(설계 3-4·D5·D8). RhythmSession + 반주 + 클릭 예약을 한 곳에서 묶는다.
// audio는 import하지 않는다(같은 층) — 클릭·반주 제어는 deps로 주입받는다(Metronome과 같은 방식).
import { diagTap } from '@/engine/diagTap';
import type { RhythmSession } from '@/engine/RhythmSession';
import { beatTimeMs } from '@/domain/time/tempo';
import { retick, tickPosition, type ClickLevel, type Subdivision } from '@/domain/time/metronome';
import { clockStalled } from '@/domain/time/audioClock';
import {
  CLICK_AHEAD_SEC,
  CLICK_LATE_SKIP_SEC,
  HIDDEN_CLICK_AHEAD_SEC,
  contextToHeardPerfMs,
  heardOffsetMs,
  sessionStartPerf,
  smoothOffsetMs,
  songToContextSec,
  stallAwareHeard,
  type AudioReading,
  type HeardState,
} from '@/domain/time/audioTimeline';

/** 박 클릭을 미리 예약하는 선행 시간. 프레임 간격(16ms)보다 넉넉하게 */
export const CLICK_LOOKAHEAD_MS = 200;
/** 재개 시 반주 예약 여유. 세션 시계도 같은 만큼 뒤로 맞춘다 */
export const RESUME_LEAD_MS = 50;
/** begin에서 반주 0초(카운트인 제외)까지 두는 기본 여유 */
export const BEGIN_LEAD_MS = 300;
/** 박 예약 타이머 간격. rAF와 무관하게 돈다(Metronome의 TICK_MS와 같은 값) */
export const SCHEDULE_TICK_MS = 25;
/** 탭이 숨겨져 타이머가 느려질 때의 lookahead(Metronome의 HIDDEN_LOOKAHEAD_MS와 같은 규칙) */
export const HIDDEN_LOOKAHEAD_MS = 1200;
/** 반주 시계 드리프트(accDrift) 발행 주기 */
export const ACC_DRIFT_INTERVAL_MS = 500;

/** 반주 재생기 중 PlayClock이 쓰는 부분(Accompaniment가 만족한다) */
export interface ClockAccompaniment {
  start(atPerfMs: number, fromMs: number): void;
  pause(): number;
  resume(atPerfMs: number): void;
  stop(): void;
  /** 마지막 start·resume의 반주 0초 시각(performance.now). 동기 Δ 측정용 */
  readonly zeroPerfMs?: number | null;
  /** perfMs 시점의 오디오 시계 기준 반주 위치(ms, 1배 곡 시각 축). 재생 중이 아니거나 시작 전이면 null. 드리프트 측정용 */
  audioPositionAt?(perfMs: number): number | null;
  /** 오디오 시계 시각 ctxSec(초)에 fromMs 위치가 울리도록 예약. 오디오 시계 기준 연주에서 쓴다 */
  startAtContext?(ctxSec: number, fromMs: number): void;
}

export interface PlayClockDeps {
  /** 클릭 예약. 실제 예약된 시각(ms)을 돌려준다 */
  click(atMs: number, level: ClickLevel): number | null;
  accompaniment?: ClockAccompaniment;
  /** 곡 중 박 클릭을 낼지. 카운트인의 정박은 항상 낸다. 사이 박(8분 분할)은 카운트인에서도 이 값이 켜져 있을 때만 낸다 */
  clickOn(): boolean;
  /**
   * 박당 클릭 수(설계 MODE-002-MODE-003-metronome-subdivision). 예약할 때마다 읽으므로 연주 중에 바뀌어도 한 박 안에 반영된다.
   * 없으면 1(4분음표) — 리듬 게임은 넘기지 않는다
   */
  subdivision?(): Subdivision;
  now?(): number;
  /** begin에서 반주 0초까지 두는 여유(ms). 기본 300 */
  lead?: number;
  /** 박 예약 타이머 주입(테스트용). 기본 globalThis */
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(id: unknown): void;
  visibility?(): 'visible' | 'hidden';
  /** 정박이 예약될 때마다(카운트인 포함, 사이 박은 부르지 않는다). atMs는 그 박이 울리는 performance.now 시각(최대 lookahead만큼 미래) */
  onBeat?(beatInBar: number, atMs: number): void;
  /** 세션이 끝났을 때 1회 */
  onFinish?(): void;
  /** 지금의 화면 시계·오디오 시계 값(곡 도중 멈춤 진단용). 없거나 null이면 진단하지 않는다 */
  audioClock?(): { perfMs: number; ctxSec: number } | null;
  /**
   * 오디오 시계 읽기(설계 MODE-001 연주 시계를 오디오 시계 하나로). clickAt과 함께 주고 begin 때 값이 있으면
   * 반주·클릭을 오디오 시계에 바로 예약하고 세션 곡 시각을 들리는 오디오 시각에서 다시 계산한다. 없으면 예전 방식(화면 시계)
   */
  audioReading?(): AudioReading | null;
  /** 오디오 시계 시각(초)에 클릭 예약. 실제 예약된 오디오 시계 시각을 돌려준다 */
  clickAt?(ctxSec: number, level: ClickLevel): number | null;
  /**
   * 탭 가림 상태 변경 구독(테스트 주입용). 해제 함수를 돌려준다. 기본은 document visibilitychange.
   * 가려지는 순간 브라우저가 타이머를 최대 1초 늦추므로 그 전에 넓은 예약 창으로 한 번 예약한다
   */
  onVisibilityChange?(fn: () => void): () => void;
}

export type ClockPhase = 'idle' | 'running' | 'paused' | 'finished';

export interface ClockState {
  phase: ClockPhase;
  /** pause에 넘긴 사유. running·idle이면 null */
  reason: string | null;
}

export class PlayClock {
  private session: RhythmSession;
  private deps: PlayClockDeps;
  /** 다음에 예약할 틱(카운트인 첫 박 = 0). 박 위치 = nextTick ÷ sub */
  private nextTick = 0;
  /** nextTick을 센 박 분할 */
  private sub: Subdivision = 1;
  private timer: unknown = null;
  private unsubVisibility: (() => void) | null = null;
  private pausedSongTime = 0;
  private _state: ClockState = { phase: 'idle', reason: null };
  private lastDriftAt = -Infinity;
  private lastStallAt = -Infinity;
  /** 직전에 읽은 (화면 시계 − 오디오 시계) 차이(ms). 시작·일시정지·재개에서 비운다 */
  private prevClockOffset: number | null = null;
  private _sync: { begin: number | null; resume: number | null } = { begin: null, resume: null };
  /** 오디오 시계 기준으로 도는지(begin에서 정함) */
  private audioMode = false;
  /** 곡 0ms를 울리는 오디오 시계 시각(초) */
  private ctxZero = 0;
  /** 들리는 오디오 시각과 화면 시계 차이의 고른 값(ms). audioTimeline.heardOffsetMs */
  private heardOffset: number | null = null;
  /** 마지막으로 세션에 넣은 곡 시각. 곡 시각이 줄지 않게 하는 바닥 */
  private lastSong: number | null = null;
  /** 들리는 시각 추정 상태(멈춤 판단). audioTimeline.stallAwareHeard */
  private heardState: HeardState | null = null;
  /** 오디오가 멈춘 동안 묶어 둔 곡 시각. 흐르면 null */
  private frozenSong: number | null = null;

  constructor(session: RhythmSession, deps: PlayClockDeps) {
    this.session = session;
    this.deps = deps;
  }

  get state(): ClockState {
    return this._state;
  }

  /** 반주 동기 Δ(ms) = 반주 0초 시각 − 세션 0ms 시각. 마지막 begin·resume 기준, 반주가 없으면 null */
  get sync(): { begin: number | null; resume: number | null } {
    return this._sync;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    const si = this.deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.timer = si(() => this.schedule(this.now()), SCHEDULE_TICK_MS);
    const onVis = () => this.schedule(this.now());
    if (this.deps.onVisibilityChange) this.unsubVisibility = this.deps.onVisibilityChange(onVis);
    else if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis);
      this.unsubVisibility = () => document.removeEventListener('visibilitychange', onVis);
    }
  }

  private stopTimer(): void {
    this.unsubVisibility?.();
    this.unsubVisibility = null;
    if (this.timer === null) return;
    const ci = this.deps.clearInterval ?? ((id) => globalThis.clearInterval(id as number));
    ci(this.timer);
    this.timer = null;
  }

  private lookahead(): number {
    const v = this.deps.visibility
      ? this.deps.visibility()
      : typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? 'hidden'
        : 'visible';
    return v === 'hidden' ? HIDDEN_LOOKAHEAD_MS : CLICK_LOOKAHEAD_MS;
  }

  /** 곡 시각(ms). 카운트인은 음수 */
  songTime(now: number = this.now()): number {
    return this.session.songTime(now);
  }

  /**
   * 곡 시각 songMs를 울릴 오디오 시계 시각(초, ctxZero + 곡 시각). 오디오 시계 기준으로 돌 때만, 아니면 null.
   * 채보 자동 재생이 반주·클릭과 같은 기준으로 소리를 예약할 때 쓴다. 곡 시각이 잠깐 멈춰 있어도(재개 직후·오디오 멈춤) 그대로 맞다
   */
  songTimeToContext(songMs: number): number | null {
    if (!this.audioMode) return null;
    return songToContextSec(songMs, this.ctxZero);
  }

  /** 곡 0ms를 울리는 오디오 시계 시각(초). 오디오 시계 기준으로 돌 때만, 아니면 null */
  get contextZero(): number | null {
    return this.audioMode ? this.ctxZero : null;
  }

  /**
   * 리드인(카운트다운) → 1마디 1박(originMs) = 세션 originMs. 반주 0초 = 세션 0ms.
   * 리드인이 원점에서 끝나도록 반주 0초는 now + lead + max(0, preRollMs − originMs)에 울린다.
   * originMs가 리드인보다 길면 반주(인트로)가 먼저 시작되고 1마디 직전에 카운트인 클릭이 난다.
   */
  begin(): void {
    const now = this.now();
    const at = now + (this.deps.lead ?? BEGIN_LEAD_MS) + Math.max(0, this.session.preRollMs - this.session.originMs);
    this.nextTick = 0;
    this.sub = this.deps.subdivision?.() ?? 1;
    this.lastDriftAt = -Infinity;
    this.resetStall();
    this._sync = { begin: null, resume: null };
    const r = this.deps.clickAt ? (this.deps.audioReading?.() ?? null) : null;
    this.audioMode = r !== null;
    if (r) {
      // 곡 0ms를 오디오 시계 시각 하나로 정하고 반주·클릭을 그 기준으로 예약한다
      this.ctxZero = r.ctxSec + (at - now) / 1000;
      this.heardOffset = heardOffsetMs(r);
      this.lastSong = null;
      this.heardState = null;
      this.frozenSong = null;
      this.session.start(contextToHeardPerfMs(this.ctxZero, this.heardOffset));
      this.startAccompaniment(0);
    } else {
      this.session.start(at);
      this.deps.accompaniment?.start(at, 0);
    }
    this._sync.begin = this.measureDelta(now);
    this._state = { phase: 'running', reason: null };
    this.startTimer();
    this.schedule(now);
  }

  /** 반주 0초 시각 − 세션 0ms 시각(ms). 반주가 없거나 측정 불가면 null */
  private measureDelta(ref: number): number | null {
    const zero = this.deps.accompaniment?.zeroPerfMs;
    if (zero === undefined || zero === null) return null;
    // 세션 0ms의 performance.now 시각 = ref − songTime(ref)
    return zero - (ref - this.session.songTime(ref));
  }

  /** 반주를 곡 시각 fromMs부터 ctxZero 기준 오디오 시계 시각에 예약한다. startAtContext가 없으면 화면 시계로 */
  private startAccompaniment(fromMs: number): void {
    const acc = this.deps.accompaniment;
    if (!acc) return;
    const from = Math.max(0, fromMs);
    if (acc.startAtContext) acc.startAtContext(songToContextSec(from, this.ctxZero), from);
    else acc.start(contextToHeardPerfMs(songToContextSec(from, this.ctxZero), this.heardOffset ?? 0), from);
  }

  /**
   * 들리는 오디오 시각으로 세션 startTime을 다시 넣는다(오디오 시계 기준일 때만). 곡 시각은 줄지 않는다.
   * 오디오 시계가 멈추면 곡 시각도 멈추고, 들리는 시각 추정값의 작은 흔들림은 고르게 따라간다
   */
  private retime(): void {
    if (!this.audioMode || this.session.currentStatus === 'paused') return;
    const r = this.deps.audioReading?.();
    if (!r) {
      // 컨텍스트가 running이 아니면(suspended·interrupted) 오디오가 안 흐르므로 곡 시각을 멈춘다
      this.freeze();
      this.heardState = null;
      return;
    }
    const h = stallAwareHeard(this.heardState, r);
    this.heardState = h.state;
    if (h.stalled) {
      this.freeze();
      return;
    }
    this.frozenSong = null;
    this.heardOffset = smoothOffsetMs(this.heardOffset, heardOffsetMs({ ...r, heardCtxSec: h.heardCtxSec }));
    // 바닥은 직전 값과 지금 화면이 보고 있는 값(직전 다시 넣기 뒤 화면 시계로 이어 셈한 값) 중 큰 쪽. 프레임 사이에 읽힌 값보다 뒤로 가지 않게 한다
    const shown = this.session.songTime(r.perfMs);
    const floor = this.lastSong === null ? null : Math.max(this.lastSong, shown);
    const next = sessionStartPerf(this.heardOffset, this.ctxZero, r.perfMs, floor);
    this.session.retime(next.startPerf, next.held ? next.songMs : null);
    this.lastSong = next.songMs;
  }

  /**
   * 오디오가 안 흐르는 동안 곡 시각을 멈춘다. 처음 멈출 때 화면이 보고 있던 곡 시각(직전 다시 넣기 뒤 화면 시계로 이어 셈한 값)에 묶어
   * 뒤로 돌아가지 않게 한다. 오디오가 다시 흐르면 들리는 곡 시각이 이 값을 넘을 때까지 그대로 둔다
   */
  private freeze(): void {
    const now = this.now();
    if (this.frozenSong === null) this.frozenSong = Math.max(this.lastSong ?? -Infinity, this.session.songTime(now));
    this.session.retime(now - this.frozenSong, this.frozenSong);
    this.lastSong = this.frozenSong;
  }

  /** 매 프레임(rAF): 세션 시각 다시 넣기, 세션 tick과 종료 감지. 박 예약은 자체 타이머의 schedule이 맡는다 */
  onFrame(now: number): void {
    if (this._state.phase !== 'running') return;
    this.retime();
    this.session.tick(now);
    if (this.session.currentStatus === 'finished') {
      this._state = { phase: 'finished', reason: null };
      this.stopTimer();
      this.deps.accompaniment?.stop();
      this.deps.onFinish?.();
    }
  }

  /** 박 분할을 다시 읽는다. 바뀌었으면 다음 틱을 새 분할로 옮긴다(박 위치는 그대로) */
  private readSubdivision(): Subdivision {
    const sub = this.deps.subdivision?.() ?? 1;
    if (sub !== this.sub) {
      this.nextTick = retick(this.nextTick, this.sub, sub);
      this.sub = sub;
    }
    return sub;
  }

  /**
   * 틱 하나의 소리 단계. 정박은 원점 전(카운트인)이면 항상, 곡 중이면 clickOn()일 때 낸다.
   * 사이 박은 카운트인·곡 중 모두 clickOn()일 때만 낸다. 소리를 안 내면 null
   */
  private clickLevel(level: ClickLevel, isBeat: boolean, beforeOrigin: boolean): ClickLevel | null {
    if (isBeat) return beforeOrigin || this.deps.clickOn() ? level : null;
    return this.deps.clickOn() ? level : null;
  }

  /**
   * 박 클릭·onBeat 예약(타이머 콜백). lookahead 안의 틱(박 × 박 분할)을 미리 예약한다.
   * 이미 50ms 넘게 지난 틱(타이머가 늦어 놓친 틱)은 클릭도 onBeat도 없이 건너뛴다.
   */
  private schedule(now: number): void {
    if (this._state.phase !== 'running' || this.session.currentStatus === 'paused') return;
    if (this.audioMode) {
      this.scheduleAudio(now);
      return;
    }
    const t = this.session.songTime(now);
    this.measureAccDrift(now, t);
    this.measureClockStall(now, t);
    const countInBeats = Math.round(this.session.countInMs / this.session.beatMs);
    const beatsPerBar = this.session.chart.beatsPerBar;
    const duration = this.session.chart.durationMs;
    const originMs = this.session.originMs;
    const ahead = this.lookahead();
    const sub = this.readSubdivision();
    // 틱 i의 곡 시각 = 원점부터 (i ÷ 분할 − 카운트인 박 수)번째 박 위치. 빠르기 구간이 있으면 구간 bpm을 따른다(domain/time/tempo).
    for (;;) {
      const bt = beatTimeMs(this.session.chart, this.nextTick / sub - countInBeats);
      if (bt > t + ahead || bt > duration) break;
      if (bt >= t - 50) {
        const atMs = now + (bt - t);
        const pos = tickPosition(this.nextTick, sub, beatsPerBar);
        const level = this.clickLevel(pos.level, pos.isBeat, bt < originMs);
        if (level) this.deps.click(atMs, level);
        if (pos.isBeat) this.deps.onBeat?.(pos.beatInBar, atMs);
      }
      this.nextTick += 1;
    }
  }

  /**
   * 오디오 시계 기준 박 예약. 박 i는 ctxZero + 박 시각에 오디오 시계로 바로 예약하므로 출력 지연이 얼마든 반주와 같은 기준이다.
   * currentTime + 예약 여유(오디오 시계 기준) 안의 박을 예약하고, CLICK_LATE_SKIP_SEC 넘게 지난 박은 건너뛴다
   */
  private scheduleAudio(now: number): void {
    // 컨텍스트가 멈춰 읽기 값이 없어도 곡 시각은 멈춰야 하므로 먼저 다시 넣는다
    this.retime();
    const r = this.deps.audioReading?.();
    if (!r) return;
    this.measureClockStall(now, this.session.songTime(now));
    const countInBeats = Math.round(this.session.countInMs / this.session.beatMs);
    const beatsPerBar = this.session.chart.beatsPerBar;
    const duration = this.session.chart.durationMs;
    const originMs = this.session.originMs;
    const aheadSec = this.lookahead() === HIDDEN_LOOKAHEAD_MS ? HIDDEN_CLICK_AHEAD_SEC : CLICK_AHEAD_SEC;
    const sub = this.readSubdivision();
    for (;;) {
      const bt = beatTimeMs(this.session.chart, this.nextTick / sub - countInBeats);
      const ctxAt = songToContextSec(bt, this.ctxZero);
      if (ctxAt > r.ctxSec + aheadSec || bt > duration) break;
      if (ctxAt >= r.ctxSec - CLICK_LATE_SKIP_SEC) {
        const pos = tickPosition(this.nextTick, sub, beatsPerBar);
        const level = this.clickLevel(pos.level, pos.isBeat, bt < originMs);
        if (level) this.deps.clickAt?.(ctxAt, level);
        if (pos.isBeat) this.deps.onBeat?.(pos.beatInBar, contextToHeardPerfMs(ctxAt, this.heardOffset ?? heardOffsetMs(r)));
      }
      this.nextTick += 1;
    }
  }

  /**
   * 반주 시계 드리프트를 ACC_DRIFT_INTERVAL_MS마다 진단 탭에 낸다(보정 없음).
   * 드리프트 = 오디오 시계 기준 반주 위치 − 세션 곡 시각. 구독자가 없거나 반주가 아직 울리지 않으면 건너뛴다.
   */
  private measureAccDrift(now: number, songTimeMs: number): void {
    if (!diagTap.active || now - this.lastDriftAt < ACC_DRIFT_INTERVAL_MS) return;
    const audioPosMs = this.deps.accompaniment?.audioPositionAt?.(now);
    if (audioPosMs === undefined || audioPosMs === null) return;
    this.lastDriftAt = now;
    diagTap.publish({ type: 'accDrift', songTimeMs, audioPosMs, driftMs: audioPosMs - songTimeMs });
  }

  private resetStall(): void {
    this.lastStallAt = -Infinity;
    this.prevClockOffset = null;
  }

  /**
   * 곡 도중 오디오 시계가 멈췄다 흐른 흔적을 ACC_DRIFT_INTERVAL_MS마다 진단 탭에 낸다(처리 없음, 설계 MODE-001 오디오 시계 시작 대기 D6).
   * (화면 시계 − 오디오 시계) 차이가 직전보다 CLOCK_STALL_MS 넘게 커졌으면 그만큼 멈췄던 것이다. 구독자가 없으면 건너뛴다.
   */
  private measureClockStall(now: number, songTimeMs: number): void {
    if (!diagTap.active || now - this.lastStallAt < ACC_DRIFT_INTERVAL_MS) return;
    const r = this.deps.audioClock?.();
    if (!r) return;
    this.lastStallAt = now;
    const offset = r.perfMs - r.ctxSec * 1000;
    if (clockStalled(this.prevClockOffset, offset)) {
      diagTap.publish({ type: 'audioClockStall', songTimeMs, jumpMs: Math.round(offset - (this.prevClockOffset ?? offset)) });
    }
    this.prevClockOffset = offset;
  }

  /** 세션·반주를 한 번에 멈춘다. 이미 예약된 클릭은 지난 것만(최대 lookahead) 울린다 */
  pause(reason: string): void {
    if (this._state.phase !== 'running') return;
    const now = this.now();
    this.stopTimer();
    this.retime();
    this.pausedSongTime = this.session.songTime(now);
    this.session.pause(now);
    this.deps.accompaniment?.pause();
    this.lastDriftAt = -Infinity;
    this.resetStall();
    this._state = { phase: 'paused', reason };
  }

  /**
   * 재개. 반주는 새 소스를 예약해야 하므로 RESUME_LEAD_MS 뒤에 울린다.
   * 세션 시계도 같은 만큼 뒤로 맞춰 둘이 같은 시각을 가리키게 한다.
   * 카운트인 중에 멈췄다면 남은 카운트인만큼 더 뒤에 울린다.
   */
  resume(): void {
    if (this._state.phase !== 'paused') return;
    const r = this.audioMode ? (this.deps.audioReading?.() ?? null) : null;
    if (r) {
      // 멈춘 곡 시각을 RESUME_LEAD_MS 뒤의 오디오 시계 시각에 다시 놓는다. 곡 시각은 멈춘 값에서 다시 흐른다
      const now = this.now();
      this.ctxZero = r.ctxSec + RESUME_LEAD_MS / 1000 - this.pausedSongTime / 1000;
      this.heardOffset = heardOffsetMs(r);
      this.heardState = null;
      this.frozenSong = null;
      this.session.resume(now);
      const next = sessionStartPerf(this.heardOffset, this.ctxZero, r.perfMs, this.pausedSongTime);
      this.session.retime(next.startPerf, next.held ? next.songMs : null);
      this.lastSong = next.songMs;
      this.startAccompaniment(this.pausedSongTime);
      this._sync.resume = this.measureDelta(now + RESUME_LEAD_MS);
      this._state = { phase: 'running', reason: null };
      this.startTimer();
      return;
    }
    const at = this.now() + RESUME_LEAD_MS;
    this.session.resume(at);
    this.deps.accompaniment?.resume(at + Math.max(0, -this.pausedSongTime));
    this._sync.resume = this.measureDelta(at);
    this._state = { phase: 'running', reason: null };
    this.startTimer();
  }

  /** 같은 채보로 카운트인부터 다시. 세션 판정·점수는 비운다 */
  restart(): void {
    this.stop();
    this.session.reset();
    this.begin();
  }

  /** 반주 정지, 클릭 예약 중단. 세션 상태는 건드리지 않는다 */
  stop(): void {
    this.stopTimer();
    this.deps.accompaniment?.stop();
    this._state = { phase: 'idle', reason: null };
  }
}
