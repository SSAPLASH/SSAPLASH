// 박 분할 예시 소리(설계 MODE-002-MODE-003-metronome-subdivision D14). 분할을 고르면 그 자리의 BPM으로 두 박을 들려준다.
// 앱에 하나뿐인 인스턴스다. 클릭 출력·오디오 켜기·「지금 내도 되는가」는 bind로 주입받는다(bootstrap).
// 예약은 전역 메트로놈과 같은 방식(창 100ms·틱 25ms)이라 다시 고르거나 stop하면 타이머만 멈추면 된다(이미 예약된 한 틱은 울릴 수 있다).
import { LOOKAHEAD_MS, START_LEAD_MS, TICK_MS } from '@/engine/Metronome';
import { beatIntervalMs, previewTicks, type ClickLevel, type PreviewTick, type Subdivision } from '@/domain/time/metronome';

/** 예시 소리를 낸 자리. 그 자리의 점(PreviewDots)만 켜진다 */
export type PreviewPlace = 'song' | 'dock' | 'settings';

export interface PreviewSnapshot {
  /** 울리는 중인 자리. 아니면 null */
  place: PreviewPlace | null;
  /** 지금 울린 정박(0부터). 첫 박 전·끝난 뒤 -1 */
  beat: number;
}

export interface MetronomePreviewDeps {
  click: (atMs: number, level: ClickLevel) => number | null;
  ensureAudio: () => Promise<void>;
  /** 메트로놈이 이미 울리고 있거나 곡 연주 중이면 true — 예시 소리를 내지 않는다 */
  busy: () => boolean;
  renderAheadMs?: () => number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

const IDLE: PreviewSnapshot = { place: null, beat: -1 };

export class MetronomePreview {
  private deps: MetronomePreviewDeps | null = null;
  private snap: PreviewSnapshot = IDLE;
  private listeners = new Set<() => void>();
  /** play·stop마다 올린다. ensureAudio를 기다리는 사이 다른 호출이 오면 앞의 것은 버린다 */
  private seq = 0;
  private interval: unknown = null;
  private timeouts = new Set<unknown>();

  bind(deps: MetronomePreviewDeps): void {
    this.deps = deps;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PreviewSnapshot => this.snap;

  /** 앞의 예시를 끊고 place 자리에서 bpm·분할로 두 박을 낸다. busy면 아무것도 하지 않는다 */
  async play(place: PreviewPlace, bpm: number, subdivision: Subdivision): Promise<void> {
    const d = this.deps;
    this.stop();
    if (!d || d.busy()) return;
    const ticks = previewTicks(bpm, subdivision);
    if (ticks.length === 0) return;
    const seq = this.seq;
    try {
      await d.ensureAudio();
    } catch {
      return;
    }
    if (seq !== this.seq || d.busy()) return;
    const now = d.now ?? (() => performance.now());
    const ahead = d.renderAheadMs ?? (() => 0);
    const startMs = now() + START_LEAD_MS + ahead();
    let next = 0;
    this.set({ place, beat: -1 });
    const schedule = () => {
      const until = now() + LOOKAHEAD_MS + ahead();
      while (next < ticks.length && startMs + ticks[next].offsetMs <= until) {
        this.fire(ticks[next], startMs + ticks[next].offsetMs, seq);
        next += 1;
      }
      if (next < ticks.length) return;
      this.clearInterval();
      // 마지막 박이 한 박 길이만큼 울린 뒤 점을 끈다
      this.later(() => this.finish(seq), startMs + ticks[ticks.length - 1].offsetMs + beatIntervalMs(bpm) / subdivision - now());
    };
    this.interval = (d.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms)))(schedule, TICK_MS);
    schedule();
  }

  /** 남은 틱을 내지 않고 점을 끈다 */
  stop(): void {
    this.seq += 1;
    this.clearInterval();
    const ct = this.deps?.clearTimeout ?? ((id) => globalThis.clearTimeout(id as number));
    for (const id of this.timeouts) ct(id);
    this.timeouts.clear();
    this.set(IDLE);
  }

  private fire(tick: PreviewTick, atMs: number, seq: number): void {
    const d = this.deps;
    if (!d) return;
    d.click(atMs, tick.level);
    const beat = tick.beat;
    if (beat === null) return;
    const now = d.now ?? (() => performance.now());
    this.later(() => {
      if (seq === this.seq && this.snap.place !== null) this.set({ place: this.snap.place, beat });
    }, atMs - now());
  }

  private finish(seq: number): void {
    if (seq === this.seq) this.set(IDLE);
  }

  private later(fn: () => void, delayMs: number): void {
    const st = this.deps?.setTimeout ?? ((f, ms) => globalThis.setTimeout(f, ms));
    const id: unknown = st(() => {
      this.timeouts.delete(id);
      fn();
    }, Math.max(0, delayMs));
    this.timeouts.add(id);
  }

  private clearInterval(): void {
    if (this.interval === null) return;
    (this.deps?.clearInterval ?? ((id) => globalThis.clearInterval(id as number)))(this.interval);
    this.interval = null;
  }

  private set(next: PreviewSnapshot): void {
    if (next.place === this.snap.place && next.beat === this.snap.beat) return;
    this.snap = next;
    for (const l of this.listeners) l();
  }
}

export const metronomePreview = new MetronomePreview();
