// 박자 맞추기 진행(설계 PLAY-004-timing-offset-calibration 4-1). 클릭 16박을 예약하고, 그동안의 타격을 가로채 소리만 낸 뒤
// 박과 타격의 어긋남으로 판정 타이밍 보정값을 계산한다. 계산은 domain/timingCalibration, 화면은 TimingCalDialog가 맡는다.
// bootstrap이 bind()로 의존을 넣고 타격 핸들러에서 intercept()를 부른다. 설정 저장은 하지 않는다(적용은 화면이 한다).
import type { ResolvedHit } from '@/domain/events';
import { isSensorSource } from '@/domain/events';
import {
  evaluateTimingCal,
  timingCalBeatMs,
  TIMING_CAL_LISTEN_BEATS,
  TIMING_CAL_MEASURE_BEATS,
  TIMING_CAL_PAIR_WINDOW_MS,
  type TimingCalResult,
  type TimingCalTap,
} from '@/domain/timingCalibration';

/** 클릭을 미리 예약하는 창과 틱(전역 메트로놈과 같은 값) */
const LOOKAHEAD_MS = 100;
const TICK_MS = 25;
/** 시작을 누른 뒤 첫 박까지의 여유 */
const START_LEAD_MS = 400;

export const TIMING_CAL_TOTAL_BEATS = TIMING_CAL_LISTEN_BEATS + TIMING_CAL_MEASURE_BEATS;

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
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

/** idle 대기 / starting 오디오 준비 / listen 듣기 박 / measure 측정 박 / result 결과 */
export type TimingCalPhase = 'idle' | 'starting' | 'listen' | 'measure' | 'result';

export interface TimingCalSnapshot {
  phase: TimingCalPhase;
  /** 지금까지 울린 박 수(0~16) */
  beat: number;
  /** 측정 박과 짝지을 수 있는 타격 수(화면 진행 표시용) */
  taps: number;
  result: TimingCalResult | null;
  /** 결과를 낼 때 읽은 출력 지연(ms) */
  outputLatencyMs: number | null;
}

const IDLE: TimingCalSnapshot = { phase: 'idle', beat: 0, taps: 0, result: null, outputLatencyMs: null };

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
    return this.snap.phase === 'listen' || this.snap.phase === 'measure';
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
    this.planned = Array.from({ length: TIMING_CAL_TOTAL_BEATS }, (_, i) => now + START_LEAD_MS + i * beatMs);
    this.actual = [];
    this.taps = [];
    this.set({ ...IDLE, phase: 'listen' });
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
    this.taps.push({ tHit: hit.tHit, input: isSensorSource(hit.source) ? 'sensor' : 'keyboard' });
    const firstMeasure = this.planned[TIMING_CAL_LISTEN_BEATS] - TIMING_CAL_PAIR_WINDOW_MS;
    const taps = this.taps.filter((t) => t.tHit >= firstMeasure).length;
    if (taps !== this.snap.taps) this.set({ ...this.snap, taps });
    return true;
  }

  private tick(): void {
    const d = this.deps;
    if (!d || !this.running) return;
    const now = (d.now ?? (() => performance.now()))();
    // 창 안에 들어온 박을 예약한다
    while (this.actual.length < this.planned.length && this.planned[this.actual.length] <= now + LOOKAHEAD_MS) {
      const i = this.actual.length;
      const at = d.click(this.planned[i], i % 4 === 0);
      this.actual.push(at ?? this.planned[i]);
    }
    // 울린 박 수와 단계
    let beat = 0;
    while (beat < this.actual.length && this.actual[beat] <= now) beat++;
    const phase: TimingCalPhase = beat > TIMING_CAL_LISTEN_BEATS ? 'measure' : 'listen';
    if (beat !== this.snap.beat || phase !== this.snap.phase) this.set({ ...this.snap, beat, phase });
    // 마지막 박의 짝짓기 폭이 지나면 끝낸다
    const last = this.actual[TIMING_CAL_TOTAL_BEATS - 1];
    if (last !== undefined && now >= last + TIMING_CAL_PAIR_WINDOW_MS) this.finish();
  }

  private finish(): void {
    this.stopTimer();
    const result = evaluateTimingCal(this.actual.slice(TIMING_CAL_LISTEN_BEATS), this.taps);
    this.set({ ...this.snap, phase: 'result', beat: TIMING_CAL_TOTAL_BEATS, result, outputLatencyMs: this.deps?.outputLatencyMs() ?? null });
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
