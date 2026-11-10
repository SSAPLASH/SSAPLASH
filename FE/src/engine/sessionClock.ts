// 세션 시계(설계 3-4·D5·D8). RhythmSession + 반주 + 클릭 예약을 한 곳에서 묶는다.
// audio는 import하지 않는다(같은 층) — 클릭·반주 제어는 deps로 주입받는다(Metronome과 같은 방식).
import { diagTap } from './diagTap';
import type { RhythmSession } from './RhythmSession';
import { beatTimeMs } from '@/domain/tempo';

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
}

export interface PlayClockDeps {
  /** 클릭 예약. 실제 예약된 시각(ms)을 돌려준다 */
  click(atMs: number, accent: boolean): number | null;
  accompaniment?: ClockAccompaniment;
  /** 곡 중 박 클릭을 낼지. 카운트인은 항상 낸다 */
  clickOn(): boolean;
  now?(): number;
  /** begin에서 반주 0초까지 두는 여유(ms). 기본 300 */
  lead?: number;
  /** 박 예약 타이머 주입(테스트용). 기본 globalThis */
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(id: unknown): void;
  visibility?(): 'visible' | 'hidden';
  /** 박이 예약될 때마다(카운트인 포함). atMs는 그 박이 울리는 performance.now 시각(최대 lookahead만큼 미래) */
  onBeat?(beatInBar: number, atMs: number): void;
  /** 세션이 끝났을 때 1회 */
  onFinish?(): void;
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
  private nextBeat = 0;
  private timer: unknown = null;
  private pausedSongTime = 0;
  private _state: ClockState = { phase: 'idle', reason: null };
  private lastDriftAt = -Infinity;
  private _sync: { begin: number | null; resume: number | null } = { begin: null, resume: null };

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
  }

  private stopTimer(): void {
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
   * 리드인(카운트다운) → 1마디 1박(originMs) = 세션 originMs. 반주 0초 = 세션 0ms.
   * 리드인이 원점에서 끝나도록 반주 0초는 now + lead + max(0, preRollMs − originMs)에 울린다.
   * originMs가 리드인보다 길면 반주(인트로)가 먼저 시작되고 1마디 직전에 카운트인 클릭이 난다.
   */
  begin(): void {
    const now = this.now();
    const at = now + (this.deps.lead ?? BEGIN_LEAD_MS) + Math.max(0, this.session.preRollMs - this.session.originMs);
    this.nextBeat = 0;
    this.lastDriftAt = -Infinity;
    this._sync = { begin: null, resume: null };
    this.session.start(at);
    this.deps.accompaniment?.start(at, 0);
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

  /** 매 프레임(rAF): 세션 tick과 종료 감지만. 박 예약은 자체 타이머의 schedule이 맡는다 */
  onFrame(now: number): void {
    if (this._state.phase !== 'running') return;
    this.session.tick(now);
    if (this.session.currentStatus === 'finished') {
      this._state = { phase: 'finished', reason: null };
      this.stopTimer();
      this.deps.accompaniment?.stop();
      this.deps.onFinish?.();
    }
  }

  /**
   * 박 클릭·onBeat 예약(타이머 콜백). lookahead 안의 박을 미리 예약한다.
   * 이미 50ms 넘게 지난 박(타이머가 늦어 놓친 박)은 클릭도 onBeat도 없이 건너뛴다.
   */
  private schedule(now: number): void {
    if (this._state.phase !== 'running' || this.session.currentStatus === 'paused') return;
    const t = this.session.songTime(now);
    this.measureAccDrift(now, t);
    const countInBeats = Math.round(this.session.countInMs / this.session.beatMs);
    const beatsPerBar = this.session.chart.beatsPerBar;
    const duration = this.session.chart.durationMs;
    const originMs = this.session.originMs;
    const ahead = this.lookahead();
    // 박 i의 곡 시각 = 원점부터 (i − 카운트인 박 수)번째 박. 빠르기 구간이 있으면 구간 bpm을 따른다(domain/tempo).
    // 원점 전(카운트인) 클릭은 항상, 곡 중은 clickOn()
    for (;;) {
      const bt = beatTimeMs(this.session.chart, this.nextBeat - countInBeats);
      if (bt > t + ahead || bt > duration) break;
      if (bt >= t - 50) {
        const atMs = now + (bt - t);
        const beatInBar = this.nextBeat % beatsPerBar;
        if (bt < originMs || this.deps.clickOn()) this.deps.click(atMs, beatInBar === 0);
        this.deps.onBeat?.(beatInBar, atMs);
      }
      this.nextBeat += 1;
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

  /** 세션·반주를 한 번에 멈춘다. 이미 예약된 클릭은 지난 것만(최대 lookahead) 울린다 */
  pause(reason: string): void {
    if (this._state.phase !== 'running') return;
    const now = this.now();
    this.stopTimer();
    this.pausedSongTime = this.session.songTime(now);
    this.session.pause(now);
    this.deps.accompaniment?.pause();
    this.lastDriftAt = -Infinity;
    this._state = { phase: 'paused', reason };
  }

  /**
   * 재개. 반주는 새 소스를 예약해야 하므로 RESUME_LEAD_MS 뒤에 울린다.
   * 세션 시계도 같은 만큼 뒤로 맞춰 둘이 같은 시각을 가리키게 한다.
   * 카운트인 중에 멈췄다면 남은 카운트인만큼 더 뒤에 울린다.
   */
  resume(): void {
    if (this._state.phase !== 'paused') return;
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
