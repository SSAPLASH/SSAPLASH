// 전역 메트로놈 스케줄러. lookahead(창 100ms, 틱 25ms)로 클릭을 미리 예약한다.
// 예약 단위는 틱(박 × 박 분할)이다. 8분 분할이면 박 사이에 사이 박 클릭이 하나 더 나고, 박 리스너(onBeat)는 정박에만 불린다(설계 MODE-002-MODE-003-metronome-subdivision).
// 창·첫 박은 오디오 시계가 들리는 시각보다 앞선 정도만큼 더 앞에서 예약한다(설계 MODE-001, renderAheadMs).
// 클릭 출력(sink)·오디오 언락은 bind로 주입받는다 — engine은 audio·store를 import하지 않는다.
import {
  BPM_DEFAULT,
  beatAt,
  beatIndexAt,
  clampBpm,
  pushTap,
  rebaseBpm,
  retick,
  tapBpm,
  tickAt,
  ticksInWindow,
  type BeatClock,
  type BeatInfo,
  type BeatsPerBar,
  type ClickLevel,
  type Subdivision,
  type TapState,
} from '@/domain/time/metronome';

export const LOOKAHEAD_MS = 100;
export const TICK_MS = 25;
/** 첫 박·복구 기준점을 now에서 이만큼(75ms) 뒤에 둔다. Web Audio 출력 지연(수십 ms)보다 길어야 첫 박이 당겨 울리지 않고, 창(100ms) 안이라 즉시 예약된다 */
export const START_LEAD_MS = LOOKAHEAD_MS - TICK_MS;
export const HIDDEN_LOOKAHEAD_MS = 1200;

export interface MetronomeState {
  playing: boolean;
  bpm: number;
  beatsPerBar: BeatsPerBar;
  /** 박당 클릭 수(풀린 값). 잠금 중에도 마지막으로 받은 값 */
  subdivision: Subdivision;
  /** 곡 연주 중 잠금. 잠기면 bpm·beatsPerBar는 곡 값이고 자체 시계는 돌지 않는다 */
  locked: boolean;
}

export interface MetronomeStats {
  scheduled: number;
  late: number;
  maxDriftMs: number;
}

export interface MetronomeDeps {
  /** 클릭 예약. 실제 예약된 시각(ms)을 돌려준다 */
  click: (atMs: number, level: ClickLevel) => number | null;
  ensureAudio: () => Promise<void>;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  visibility?: () => 'visible' | 'hidden';
  /** AudioContext 상태 변경 구독 */
  onAudioState?: (listener: (state: string) => void) => void;
  /**
   * 오디오 시계가 들리는 시각보다 앞선 정도(ms, AudioEngine.renderAheadMs). 창·첫 박·복구 기준점에 더한다.
   * 안 더하면 출력 지연이 창보다 클 때 클릭이 "지금"으로 당겨져 늦게·불규칙하게 울린다(설계 MODE-001). 없으면 0
   */
  renderAheadMs?: () => number;
}

type Status = 'idle' | 'starting' | 'playing';

interface ResolvedDeps {
  renderAheadMs: () => number;
  click: MetronomeDeps['click'];
  ensureAudio: MetronomeDeps['ensureAudio'];
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  visibility: () => 'visible' | 'hidden';
}

export class Metronome {
  private deps: ResolvedDeps | null = null;
  private status: Status = 'idle';
  private stopRequested = false;
  private bpm = BPM_DEFAULT;
  private beatsPerBar: BeatsPerBar = 4;
  private subdivision: Subdivision = 1;
  private clock: BeatClock = { anchorMs: 0, anchorIndex: 0, bpm: BPM_DEFAULT, beatsPerBar: 4 };
  /** 다음에 예약할 틱. 박 위치 = nextTick ÷ subdivision */
  private nextTick = 0;
  private timer: unknown = null;
  private tapState: TapState = { taps: [] };
  private _stats: MetronomeStats = { scheduled: 0, late: 0, maxDriftMs: 0 };
  private beatListeners = new Set<(info: BeatInfo) => void>();
  private changeListeners = new Set<(s: MetronomeState) => void>();
  private resyncListeners = new Set<(beatInBar: number) => void>();
  private locked = false;
  private lockedBpm = BPM_DEFAULT;
  /** 곡의 박자 원값(3·4 외 값도 보존) */
  private lockedBeatsPerBarRaw = 4;
  private pulseIndex = 0;

  bind(deps: MetronomeDeps): void {
    this.deps = {
      renderAheadMs: deps.renderAheadMs ?? (() => 0),
      click: deps.click,
      ensureAudio: deps.ensureAudio,
      now: deps.now ?? (() => performance.now()),
      setInterval: deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms)),
      clearInterval: deps.clearInterval ?? ((id) => globalThis.clearInterval(id as number)),
      visibility:
        deps.visibility ??
        (() => (typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'hidden' : 'visible')),
    };
    deps.onAudioState?.((state) => {
      if (state === 'running') this.handleAudioRunning();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    }
  }

  get state(): MetronomeState {
    if (this.locked) {
      const bpb: BeatsPerBar = this.lockedBeatsPerBarRaw === 3 ? 3 : 4;
      return { playing: false, bpm: this.lockedBpm, beatsPerBar: bpb, subdivision: this.subdivision, locked: true };
    }
    return {
      playing: this.status === 'playing',
      bpm: this.bpm,
      beatsPerBar: this.beatsPerBar,
      subdivision: this.subdivision,
      locked: false,
    };
  }

  /** 잠금 중 곡의 박자 원값. 3·4 외 값도 그대로 돌려준다(표시는 state.beatsPerBar가 4로 접는다) */
  get lockedBeatsPerBar(): number {
    return this.lockedBeatsPerBarRaw;
  }

  get stats(): MetronomeStats {
    return { ...this._stats };
  }

  async start(): Promise<void> {
    const d = this.deps;
    if (!d || this.locked) return;
    if (this.status === 'starting') {
      this.stopRequested = false;
      return;
    }
    if (this.status === 'playing') return;
    this.status = 'starting';
    this.stopRequested = false;
    try {
      await d.ensureAudio();
    } catch (e) {
      this.status = 'idle';
      throw e;
    }
    if (this.stopRequested) {
      this.status = 'idle';
      this.stopRequested = false;
      return;
    }
    this.status = 'playing';
    this.clock = { anchorMs: d.now() + START_LEAD_MS + d.renderAheadMs(), anchorIndex: 0, bpm: this.bpm, beatsPerBar: this.beatsPerBar };
    this.nextTick = 0;
    this._stats = { scheduled: 0, late: 0, maxDriftMs: 0 };
    this.timer = d.setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.emitChange();
  }

  stop(): void {
    const d = this.deps;
    if (!d) return;
    if (this.status === 'starting') {
      this.stopRequested = true;
      return;
    }
    if (this.status !== 'playing') return;
    d.clearInterval(this.timer);
    this.timer = null;
    this.status = 'idle';
    this.emitChange();
  }

  toggle(): void {
    if (this.locked) return;
    if (this.status === 'idle') void this.start();
    else this.stop();
  }

  setBpm(bpm: number): void {
    if (this.locked) return;
    const c = clampBpm(bpm);
    if (c === this.bpm) return;
    if (this.status === 'playing' && this.deps) {
      this.clock = rebaseBpm(this.clock, c, this.deps.now(), this.nextPosition());
    }
    this.bpm = c;
    this.emitChange();
  }

  setBeatsPerBar(n: number): void {
    if (this.locked) return;
    if (n !== 3 && n !== 4) return;
    if (n === this.beatsPerBar) return;
    if (this.status === 'playing' && this.deps) {
      this.clock = { ...rebaseBpm(this.clock, this.bpm, this.deps.now(), this.nextPosition()), beatsPerBar: n };
    }
    this.beatsPerBar = n;
    this.emitChange();
  }

  /**
   * 박 분할(박당 클릭 수) 변경. 재생 중이면 다음 틱만 새 분할로 옮기고 박 위치·기준점은 그대로 둔다.
   * 잠금 중에도 값은 받는다(곡 클릭은 세션이 내므로 자체 시계에는 영향이 없다)
   */
  setSubdivision(sub: Subdivision): void {
    if (sub === this.subdivision) return;
    this.nextTick = retick(this.nextTick, this.subdivision, sub);
    this.subdivision = sub;
    this.emitChange();
  }

  /** 탭 템포. 반환: 현재 탭 수 */
  tap(): number {
    if (this.locked) return this.tapState.taps.length;
    const now = this.deps ? this.deps.now() : performance.now();
    this.tapState = pushTap(this.tapState, now);
    const bpm = tapBpm(this.tapState);
    if (bpm !== null) this.setBpm(bpm);
    return this.tapState.taps.length;
  }

  /** 곡 연주 시작: 자체 시계를 멈추고 곡의 BPM·박자를 표시 값으로 잠근다. 박은 세션이 pulse로 알린다 */
  lock(info: { bpm: number; beatsPerBar: number }): void {
    const d = this.deps;
    if (d) {
      if (this.status === 'starting') this.stopRequested = true;
      else if (this.status === 'playing') {
        d.clearInterval(this.timer);
        this.timer = null;
        this.status = 'idle';
      }
    }
    this.locked = true;
    this.lockedBpm = info.bpm;
    this.lockedBeatsPerBarRaw = info.beatsPerBar;
    this.pulseIndex = 0;
    this.emitChange();
  }

  /** 곡 연주 끝·이탈: 사용자 BPM·박자로 돌아가고 정지 상태가 된다 */
  unlock(): void {
    if (!this.locked) return;
    this.locked = false;
    this.emitChange();
  }

  /** 잠금 중 세션이 박을 알린다. onBeat 리스너(표시용)에게 그대로 전달한다 */
  pulse(beatInBar: number, atMs?: number): void {
    if (!this.locked) return;
    const info: BeatInfo = {
      index: this.pulseIndex++,
      beatInBar,
      accent: beatInBar === 0,
      atMs: atMs ?? (this.deps ? this.deps.now() : performance.now()),
    };
    for (const l of this.beatListeners) l(info);
  }

  /** 박이 예약되는 순간(실제 시각보다 최대 창만큼 앞) 호출 */
  onBeat(listener: (info: BeatInfo) => void): () => void {
    this.beatListeners.add(listener);
    return () => this.beatListeners.delete(listener);
  }

  onChange(listener: (s: MetronomeState) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** 탭이 다시 보이거나 오디오가 복구돼 현재 박(마디 안 인덱스)을 다시 맞춰야 할 때 */
  onResync(listener: (beatInBar: number) => void): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  /** 다음에 울릴 정박 */
  nextBeat(): BeatInfo | null {
    return this.status === 'playing' ? beatAt(this.clock, Math.ceil(this.nextPosition())) : null;
  }

  /** 다음 틱의 박 위치(사이 박이면 n.5) */
  private nextPosition(): number {
    return this.nextTick / this.subdivision;
  }

  /** 지금 울리고 있는 박의 마디 안 인덱스. 정지·시작 전이면 -1 */
  currentBeat(): number {
    if (this.status !== 'playing' || !this.deps) return -1;
    const now = this.deps.now();
    return now < this.clock.anchorMs ? -1 : beatAt(this.clock, beatIndexAt(this.clock, now)).beatInBar;
  }

  /** visibilitychange 처리. 창 크기는 틱마다 visibility()로 정해지므로 숨김이면 즉시 한 번 틱, 복귀면 현재 박 재동기만 한다 */
  handleVisibilityChange(): void {
    if (this.status !== 'playing' || !this.deps) return;
    if (this.deps.visibility() === 'hidden') this.tick();
    else this.emitResync();
  }

  /** AudioContext가 running으로 돌아옴: 놓친 박이 있으면 버리고 지금부터 이어서 정렬(버스트 방지) */
  handleAudioRunning(): void {
    if (this.status !== 'playing' || !this.deps) return;
    this.catchUp(this.deps.now());
  }

  /**
   * 다음 틱이 이미 지났으면(오디오 중단, 타이머 강한 스로틀링) 놓친 틱을 버리고 now + START_LEAD_MS를 새 기준점으로 잡는다.
   * 마디 안 위치(인덱스)는 이어진다. 다음 박이 아직 안 왔으면 아무것도 하지 않는다 — 시작 직후 statechange가 와도 박이 밀리지 않게.
   */
  private catchUp(now: number): void {
    if (tickAt(this.clock, this.nextTick, this.subdivision).atMs >= now - TICK_MS) return;
    this.clock = { anchorMs: now + START_LEAD_MS + (this.deps?.renderAheadMs() ?? 0), anchorIndex: this.nextPosition(), bpm: this.bpm, beatsPerBar: this.beatsPerBar };
    this.emitResync();
  }

  private tick(): void {
    const d = this.deps;
    if (!d || this.status !== 'playing') return;
    const now = d.now();
    this.catchUp(now);
    const window = (d.visibility() === 'hidden' ? HIDDEN_LOOKAHEAD_MS : LOOKAHEAD_MS) + d.renderAheadMs();
    const ticks = ticksInWindow(this.clock, this.subdivision, -Infinity, now + window, this.nextTick);
    for (const t of ticks) {
      const at = d.click(t.atMs, t.level);
      this._stats.scheduled++;
      // null = 소리를 예약하지 못함(오디오 미해제 등). drift를 잴 수 없으니 기록하지 않는다
      if (at !== null) {
        const drift = at - t.atMs;
        if (drift > 0) this._stats.late++;
        this._stats.maxDriftMs = Math.max(this._stats.maxDriftMs, Math.abs(drift));
      }
      this.nextTick = t.tick + 1;
      // 박 표시는 4분음표 그대로: 사이 박은 리스너에게 알리지 않는다
      if (!t.isBeat) continue;
      const beat: BeatInfo = { index: t.tick / this.subdivision, beatInBar: t.beatInBar, accent: t.level === 'accent', atMs: t.atMs };
      for (const l of this.beatListeners) l(beat);
    }
  }

  private emitChange(): void {
    const s = this.state;
    for (const l of this.changeListeners) l(s);
  }

  private emitResync(): void {
    const beat = this.currentBeat();
    for (const l of this.resyncListeners) l(beat);
  }
}

export const metronome = new Metronome();
