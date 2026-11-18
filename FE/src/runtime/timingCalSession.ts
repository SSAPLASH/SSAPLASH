// 박자 맞추기 진행(설계 PLAY-004-timing-offset-calibration 4-1, PLAY-004-timing-cal-stick-kick). 킥이 연결돼 있으면 스틱 구간 뒤 전환 박을 거쳐
// 킥 구간까지 32박, 아니면 16박의 클릭을 예약하고, 그동안의 타격을 가로채 소리만 낸 뒤
// 박과 타격의 어긋남으로 판정 타이밍 보정값을 계산한다. 계산은 domain/kit/timingCalibration, 화면은 TimingCalDialog가 맡는다.
// bootstrap이 bind()로 의존을 넣고 타격 핸들러에서 intercept()를 부른다. 설정 저장은 하지 않는다(적용은 화면이 한다).
import type { ResolvedHit } from '@/domain/events';
import { isSensorSource } from '@/domain/events';
import {
  evaluateTimingCalPhases,
  timingCalBeatMs,
  TIMING_CAL_LISTEN_BEATS,
  TIMING_CAL_KICK_BEATS,
  TIMING_CAL_MEASURE_BEATS,
  TIMING_CAL_PAIR_WINDOW_MS,
  TIMING_CAL_SWITCH_BEATS,
  type TimingCalLimb,
  type TimingCalOutcome,
  type TimingCalTap,
} from '@/domain/kit/calibration/timingCalibration';

/** 클릭을 미리 예약하는 창과 틱(전역 메트로놈과 같은 값) */
const LOOKAHEAD_MS = 100;
const TICK_MS = 25;
/** 시작을 누른 뒤 첫 박까지의 여유 */
const START_LEAD_MS = 400;

/** 킥 없이 재는 전체 박 수(듣기 + 스틱 구간) */
export const TIMING_CAL_TOTAL_BEATS = TIMING_CAL_LISTEN_BEATS + TIMING_CAL_MEASURE_BEATS;
/** 킥 구간까지 재는 전체 박 수(듣기 + 스틱 구간 + 전환 + 킥 구간) */
export const TIMING_CAL_TOTAL_BEATS_WITH_KICK = TIMING_CAL_TOTAL_BEATS + TIMING_CAL_SWITCH_BEATS + TIMING_CAL_KICK_BEATS;

/** 스틱 구간 박 번호 범위(0부터). 킥 구간은 전환 박 뒤 */
const STICK_FROM = TIMING_CAL_LISTEN_BEATS;
const STICK_TO = STICK_FROM + TIMING_CAL_MEASURE_BEATS;
const KICK_FROM = STICK_TO + TIMING_CAL_SWITCH_BEATS;
const KICK_TO = KICK_FROM + TIMING_CAL_KICK_BEATS;

export interface TimingCalDeps {
  /** 클릭 예약. 실제 예약된 시각(performance.now 기준)을 돌려준다. 소리를 못 냈으면 null */
  click: (atMs: number, accent: boolean) => number | null;
  ensureAudio: () => Promise<void>;
  /** 타격음. 게임과 같은 경로로 낸다 */
  playHit: (hit: ResolvedHit) => void;
  /** 전역 메트로놈을 멈춘다(클릭이 겹치지 않게) */
  stopMetronome: () => void;
  /** 패드 보정·재정렬이 진행 중인가. 진행 중이면 시작하지 않는다 */
  busy: () => boolean;
  /** 브라우저가 보고한 출력 지연(ms). 모르면 null */
  outputLatencyMs: () => number | null;
  /** 킥 페달이 연결돼 있는가. 시작할 때 한 번 읽어 킥 구간을 넣을지 정한다 */
  kickConnected: () => boolean;
  /**
   * 오디오 시계가 들리는 시각보다 앞선 정도(ms, AudioEngine.renderAheadMs). 첫 박 여유와 예약 창에 더한다.
   * 안 더하면 출력 지연이 창보다 클 때 클릭이 "지금"으로 당겨져 늦게·불규칙하게 울린다(설계 MODE-001). 없으면 0
   */
  renderAheadMs?: () => number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

/** idle 대기 / starting 오디오 준비 / listen 듣기 박 / measure 스틱 구간 / switch 전환 박 / kick 킥 구간 / result 결과 */
export type TimingCalPhase = 'idle' | 'starting' | 'listen' | 'measure' | 'switch' | 'kick' | 'result';

export interface TimingCalSnapshot {
  phase: TimingCalPhase;
  /** 지금까지 울린 박 수(0~totalBeats) */
  beat: number;
  /** 킥 구간을 넣었는가(시작할 때 킥이 연결돼 있었는가) */
  withKick: boolean;
  /** 전체 박 수. 킥 구간이 있으면 32, 없으면 16 */
  totalBeats: number;
  /** 지금 구간에서 짝지을 수 있는 그 구간 입력의 타격 수(화면 진행 표시용) */
  taps: number;
  outcome: TimingCalOutcome | null;
  /** 결과를 낼 때 읽은 출력 지연(ms) */
  outputLatencyMs: number | null;
}

const IDLE: TimingCalSnapshot = {
  phase: 'idle',
  beat: 0,
  withKick: false,
  totalBeats: TIMING_CAL_TOTAL_BEATS,
  taps: 0,
  outcome: null,
  outputLatencyMs: null,
};

export class TimingCalSession {
  private deps: TimingCalDeps | null = null;
  private snap: TimingCalSnapshot = IDLE;
  private listeners = new Set<() => void>();
  private timer: unknown = null;
  /** 박마다 계획한 시각 */
  private planned: number[] = [];
  /** 박마다 실제 예약된 시각. 아직 예약 전이면 길이가 짧다 */
  private actual: number[] = [];
  private taps: TimingCalTap[] = [];
  /** 이번 측정에 킥 구간이 있는가 */
  private withKick = false;
  /** 진행 중인 실행 번호. 취소 뒤 늦게 끝난 오디오 준비를 버리는 데 쓴다 */
  private run = 0;

  bind(deps: TimingCalDeps): void {
    this.deps = deps;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  snapshot = (): TimingCalSnapshot => this.snap;

  /** 듣기·측정 중인가 */
  get running(): boolean {
    const p = this.snap.phase;
    return p === 'listen' || p === 'measure' || p === 'switch' || p === 'kick';
  }

  /** 측정을 시작한다. 패드 보정 중이거나 이미 진행 중이면 false */
  async start(): Promise<boolean> {
    const d = this.deps;
    if (!d || d.busy() || this.snap.phase === 'starting' || this.running) return false;
    const run = ++this.run;
    this.set({ ...IDLE, phase: 'starting' });
    try {
      await d.ensureAudio();
    } catch {
      if (run === this.run) this.set(IDLE);
      return false;
    }
    // 오디오를 기다리는 사이 취소됐으면 시작하지 않는다
    if (run !== this.run) return false;
    d.stopMetronome();
    const now = (d.now ?? (() => performance.now()))();
    const beatMs = timingCalBeatMs();
    const ahead = d.renderAheadMs?.() ?? 0;
    this.withKick = d.kickConnected();
    const total = this.withKick ? TIMING_CAL_TOTAL_BEATS_WITH_KICK : TIMING_CAL_TOTAL_BEATS;
    this.planned = Array.from({ length: total }, (_, i) => now + START_LEAD_MS + ahead + i * beatMs);
    this.actual = [];
    this.taps = [];
    this.set({ ...IDLE, phase: 'listen', withKick: this.withKick, totalBeats: total });
    const every = d.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.timer = every(() => this.tick(), TICK_MS);
    this.tick();
    return true;
  }

  /** 측정을 그만둔다. 결과 화면이었으면 결과도 지운다 */
  cancel(): void {
    this.run++;
    this.stopTimer();
    if (this.snap !== IDLE) this.set(IDLE);
  }

  /**
   * bootstrap 타격 핸들러에서 부른다. true면 가로챘다(판정·텔레메트리·진단·드리프트 보정 생략).
   * 측정 중에는 타격음을 내고 타격 시각을 모은다. 패드가 정해지지 않은 타격은 소리 없이 버린다.
   */
  intercept(hit: ResolvedHit): boolean {
    if (!this.running || !this.deps) return false;
    if (!hit.pad) return true;
    this.deps.playHit(hit);
    // 하이햇 페달은 스틱도 킥도 아니다. 소리만 내고 모으지 않는다
    if (hit.foot === 2) return true;
    const limb: TimingCalLimb = hit.foot === 3 ? 'kick' : 'stick';
    this.taps.push({ tHit: hit.tHit, input: isSensorSource(hit.source) ? 'sensor' : 'keyboard', limb });
    this.refreshTaps();
    return true;
  }

  /** 지금 구간의 입력으로 짝지을 수 있는 타격 수를 갱신한다(전환 박에는 0) */
  private refreshTaps(): void {
    const phase = this.snap.phase;
    let taps = 0;
    if (phase === 'measure' || phase === 'kick') {
      const from = phase === 'kick' ? KICK_FROM : STICK_FROM;
      const limb: TimingCalLimb = phase === 'kick' ? 'kick' : 'stick';
      const start = this.planned[from] - TIMING_CAL_PAIR_WINDOW_MS;
      taps = this.taps.filter((t) => t.limb === limb && t.tHit >= start).length;
    }
    if (taps !== this.snap.taps) this.set({ ...this.snap, taps });
  }

  private tick(): void {
    const d = this.deps;
    if (!d || !this.running) return;
    const now = (d.now ?? (() => performance.now()))();
    // 창 안에 들어온 박을 예약한다. 창은 오디오 시계가 앞선 만큼 넓힌다
    const window = LOOKAHEAD_MS + (d.renderAheadMs?.() ?? 0);
    while (this.actual.length < this.planned.length && this.planned[this.actual.length] <= now + window) {
      const i = this.actual.length;
      const at = d.click(this.planned[i], i % 4 === 0);
      this.actual.push(at ?? this.planned[i]);
    }
    // 울린 박 수와 단계
    let beat = 0;
    while (beat < this.actual.length && this.actual[beat] <= now) beat++;
    const phase: TimingCalPhase =
      beat > KICK_FROM && this.withKick ? 'kick' : beat > STICK_TO && this.withKick ? 'switch' : beat > STICK_FROM ? 'measure' : 'listen';
    if (beat !== this.snap.beat || phase !== this.snap.phase) {
      // 구간이 바뀌면 화면의 타격 수는 새 구간 기준으로 다시 센다
      this.set({ ...this.snap, beat, phase, taps: 0 });
      this.refreshTaps();
    }
    // 마지막 박의 짝짓기 폭이 지나면 끝낸다
    const last = this.actual[this.planned.length - 1];
    if (last !== undefined && now >= last + TIMING_CAL_PAIR_WINDOW_MS) this.finish();
  }

  private finish(): void {
    this.stopTimer();
    const outcome = evaluateTimingCalPhases(
      this.actual.slice(STICK_FROM, STICK_TO),
      this.withKick ? this.actual.slice(KICK_FROM, KICK_TO) : null,
      this.taps,
    );
    this.set({ ...this.snap, phase: 'result', beat: this.planned.length, outcome, outputLatencyMs: this.deps?.outputLatencyMs() ?? null });
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    const clear = this.deps?.clearInterval ?? ((id: unknown) => globalThis.clearInterval(id as number));
    clear(this.timer);
    this.timer = null;
  }

  private set(next: TimingCalSnapshot): void {
    this.snap = next;
    for (const l of this.listeners) l();
  }
}

export const timingCalSession = new TimingCalSession();
