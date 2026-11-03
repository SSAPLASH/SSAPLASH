// 녹음 재생기 (설계 REC-001 3-9). 타격 시퀀스를 look-ahead(창 100ms, 틱 25ms)로 예약해 드럼 소리로 다시 연주한다.
// audioEngine.trigger는 예약 취소가 없으므로 짧은 구간씩만 미리 예약해, 정지하면 이미 예약된 100ms 이내 소리만 난다.
// 오디오·시계·타이머는 주입받는다 — engine은 app·components를 import하지 않는다.
import { audioEngine } from '@/audio/AudioEngine';
import type { RecordingHit } from '@/domain/recording';
import type { PadId } from '@/domain/pads';

/** 예약 창(ms). 시작 + tMs가 now + 이 값 이내인 타격을 미리 예약한다 */
export const PLAYER_LOOKAHEAD_MS = 100;
/** 틱 간격(ms) */
export const PLAYER_TICK_MS = 25;
/** 시작 시각을 now보다 이만큼 뒤에 둔다. 첫 타격이 tMs 0이어도 오디오 출력 지연 때문에 당겨 울리지 않게 한다 */
export const PLAYER_START_LEAD_MS = 50;

export interface RecordingPlayerAudio {
  trigger: (pad: PadId, velocity: number, whenMs?: number) => number | null;
  ensure: () => Promise<unknown>;
}

export interface RecordingPlayerDeps {
  audio?: RecordingPlayerAudio;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

export interface PlayOptions {
  /** 재생 길이(ms). 없으면 마지막 타격의 tMs */
  durationMs?: number;
  /** 끝까지 재생해 자동 정지했을 때(stop() 호출이 아닐 때) 한 번 호출 */
  onEnd?: () => void;
}

/** 상태 알림. start = 재생 시작, stop = stop() 호출, end = 끝까지 재생(빈 시퀀스 포함) */
export type RecordingPlayerEvent = { playing: boolean; reason: 'start' | 'stop' | 'end' };

export class RecordingPlayer {
  private readonly audio: RecordingPlayerAudio;
  private readonly now: () => number;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (id: unknown) => void;

  private hits: readonly RecordingHit[] = [];
  private cursor = 0;
  private startMs = 0;
  private durationMs = 0;
  private onEnd: (() => void) | undefined;
  private timer: unknown = null;
  private _playing = false;
  /** play·stop마다 올라간다. ensure 대기 중 호출이 겹칠 때 마지막 호출만 살린다 */
  private generation = 0;
  private listeners = new Set<(e: RecordingPlayerEvent) => void>();

  constructor(deps: RecordingPlayerDeps = {}) {
    this.audio = deps.audio ?? audioEngine;
    this.now = deps.now ?? (() => performance.now());
    this.setIntervalFn = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.clearIntervalFn = deps.clearInterval ?? ((id) => globalThis.clearInterval(id as number));
  }

  get playing(): boolean {
    return this._playing;
  }

  /** 재생 위치(ms). 재생 중이면 0~길이로 고정, 정지면 0 */
  positionMs(): number {
    if (!this._playing) return 0;
    return Math.min(this.durationMs, Math.max(0, this.now() - this.startMs));
  }

  /** hits는 tMs 오름차순이어야 한다. ensure() 실패는 그대로 던지고 재생 상태가 되지 않는다 */
  async play(hits: readonly RecordingHit[], opts: PlayOptions = {}): Promise<void> {
    this.halt();
    const gen = ++this.generation;
    await this.audio.ensure();
    if (gen !== this.generation) return; // 대기 중 stop 또는 더 새로운 play가 들어왔다
    if (hits.length === 0) {
      this.emit({ playing: false, reason: 'end' });
      opts.onEnd?.();
      return;
    }
    this.hits = hits;
    this.cursor = 0;
    this.durationMs = Math.max(0, opts.durationMs ?? hits[hits.length - 1].tMs);
    this.onEnd = opts.onEnd;
    this.startMs = this.now() + PLAYER_START_LEAD_MS;
    this._playing = true;
    this.timer = this.setIntervalFn(() => this.tick(), PLAYER_TICK_MS);
    this.emit({ playing: true, reason: 'start' });
    this.tick();
  }

  /** 추가 예약을 멈춘다. 이미 예약된 100ms 이내 소리는 그대로 난다 */
  stop(): void {
    this.generation++; // ensure 대기 중인 play도 취소
    if (!this._playing) return;
    this.halt();
    this.emit({ playing: false, reason: 'stop' });
  }

  onState(listener: (e: RecordingPlayerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 상태 알림 없이 타이머·재생 상태만 정리한다 */
  private halt(): void {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
    this._playing = false;
    this.hits = [];
    this.onEnd = undefined;
  }

  private tick(): void {
    if (!this._playing) return;
    const now = this.now();
    const until = Math.min(now + PLAYER_LOOKAHEAD_MS, this.startMs + this.durationMs);
    while (this.cursor < this.hits.length) {
      const h = this.hits[this.cursor];
      const at = this.startMs + h.tMs;
      if (at > until) break;
      this.audio.trigger(h.pad, h.velocity, at);
      this.cursor++;
    }
    if (now >= this.startMs + this.durationMs) {
      const onEnd = this.onEnd;
      this.halt();
      this.emit({ playing: false, reason: 'end' });
      onEnd?.();
    }
  }

  private emit(e: RecordingPlayerEvent): void {
    for (const l of [...this.listeners]) l(e);
  }
}

export const recordingPlayer = new RecordingPlayer();
