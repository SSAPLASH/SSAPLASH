// 약점 구간 재생기(설계 3-4). 구간 일정(SegmentPlan)을 AudioEngine 합성음 예약과 Accompaniment 반주로 실제 재생한다.
// 어떤 오류도 밖으로 던지지 않는다 — 실패하면 조용히 idle.
import { SEGMENT_LOOP_GAP_MS, type SegmentPlan } from '@/features/result/domain/segmentPlayback';
import type { Accompaniment } from '@/audio/Accompaniment';
import type { AudioEngine } from '@/audio/AudioEngine';

export interface SegmentPlayerOptions {
  rate: 1 | 0.75;
  loop: boolean;
  accompanimentUrl: string | null;
}

export type SegmentPlayerState = 'idle' | 'playing';

export interface SegmentPlayerDeps {
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** 첫 소리를 now보다 이만큼 뒤에 둬 예약이 늦지 않게 한다 */
export const SEGMENT_START_LEAD_MS = 120;

type EnginePort = Pick<AudioEngine, 'ensure' | 'triggerScheduled'> & Partial<Pick<AudioEngine, 'renderAheadMs'>>;
type AccompanimentPort = Pick<Accompaniment, 'load' | 'start' | 'stop' | 'setRate'>;

export class SegmentPlayer {
  onEnd: (() => void) | null = null;
  private _state: SegmentPlayerState = 'idle';
  private handles: { cancel: () => void }[] = [];
  private timers: unknown[] = [];
  /** play 호출마다 증가. await 중 stop·재호출이 일어났는지 판별한다 */
  private token = 0;
  private readonly now: () => number;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (id: unknown) => void;

  private readonly engine: EnginePort;
  private readonly accompaniment: AccompanimentPort | null;

  constructor(engine: EnginePort, accompaniment: AccompanimentPort | null, deps: SegmentPlayerDeps = {}) {
    this.engine = engine;
    this.accompaniment = accompaniment;
    this.now = deps.now ?? (() => performance.now());
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  get state(): SegmentPlayerState {
    return this._state;
  }

  async play(plan: SegmentPlan, opts: SegmentPlayerOptions): Promise<void> {
    this.halt();
    const token = ++this.token;
    this._state = 'playing';
    try {
      await this.engine.ensure();
      if (token !== this.token) return;
      let hasAcc = false;
      if (this.accompaniment && opts.accompanimentUrl) {
        try {
          await this.accompaniment.load(opts.accompanimentUrl);
          hasAcc = true;
        } catch {
          // 반주를 못 받으면 합성음만 재생한다
        }
        if (token !== this.token) return;
      }
      // 시작 여유에 오디오 시계가 들리는 시각보다 앞선 정도를 더한다. 안 더하면 출력 지연이 여유보다 클 때
      // 첫 소리들이 "지금"으로 당겨져 늦게 울린다(설계 MODE-001 "같은 원인의 나머지 예약 경로")
      const lead = SEGMENT_START_LEAD_MS + (this.engine.renderAheadMs?.() ?? 0);
      const startPerf = this.now() + lead;
      for (const e of plan.events) {
        const h = this.engine.triggerScheduled(e.pad, e.velocity, startPerf + e.atMs);
        if (h) this.handles.push(h);
      }
      if (hasAcc && this.accompaniment) {
        this.accompaniment.setRate(opts.rate);
        this.accompaniment.start(startPerf, plan.fromMs);
        this.timers.push(this.setT(() => this.accompaniment?.stop(), lead + plan.lengthMs));
      }
      this.timers.push(
        this.setT(() => {
          if (token !== this.token) return;
          if (opts.loop) {
            void this.play(plan, opts);
          } else {
            this.halt();
            this._state = 'idle';
            this.onEnd?.();
          }
        }, lead + plan.lengthMs + SEGMENT_LOOP_GAP_MS),
      );
    } catch {
      if (token === this.token) {
        this.halt();
        this._state = 'idle';
      }
    }
  }

  /** 예약한 합성음·반주·타이머를 모두 거두고 idle로. onEnd는 부르지 않는다 */
  stop(): void {
    this.token++;
    this.halt();
    this._state = 'idle';
  }

  private halt(): void {
    for (const h of this.handles) {
      try {
        h.cancel();
      } catch {
        // 취소 실패는 무시
      }
    }
    this.handles = [];
    for (const t of this.timers) this.clearT(t);
    this.timers = [];
    try {
      this.accompaniment?.stop();
    } catch {
      // 반주 정지 실패는 무시
    }
  }
}
