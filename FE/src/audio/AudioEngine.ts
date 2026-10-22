// PLAY-06 저지연 사운드. Web Audio로 패드 소리를 낸다.
// 소리 출처는 사운드 세트(audio/soundSets). 세트가 없거나 해당 패드 샘플이 없으면 합성음으로 폴백한다.
import type { PadId } from '@/domain/pads';
import type { SoundSet } from './soundSets';

export interface LatencyInfo {
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
}

type Voice = (ctx: AudioContext, out: AudioNode, when: number, vel: number) => void;

function noiseBuffer(ctx: AudioContext, seconds = 1): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 패드 소리 전용 버스. 음소거는 여기 게인만 0으로 해 메트로놈 클릭(master 직결)은 남긴다 */
  private padBus: GainNode | null = null;
  /** 반주 전용 버스(master 직결). 패드 음소거와 무관 */
  private accBus: GainNode | null = null;
  private padMuted = false;
  private stateListeners = new Set<(state: string) => void>();
  private noise: AudioBuffer | null = null;
  private voices: Record<PadId, Voice>;
  private set: SoundSet | null = null;

  constructor() {
    this.voices = {
      KICK: (ctx, out, t, v) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(150 + v * 40, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(1.0 * v, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.4);
      },
      SNARE: (ctx, out, t, v) => {
        const n = ctx.createBufferSource();
        n.buffer = this.noise!;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 1200 + v * 800;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.8 * v, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + v * 0.05);
        n.connect(f).connect(g).connect(out);
        n.start(t);
        n.stop(t + 0.3);
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
        og.gain.setValueAtTime(0.5 * v, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 0.15);
      },
      HIHAT: (ctx, out, t, v) => {
        const n = ctx.createBufferSource();
        n.buffer = this.noise!;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 9000;
        f.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.45 * v, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06 + v * 0.04);
        n.connect(f).connect(g).connect(out);
        n.start(t);
        n.stop(t + 0.15);
      },
      HI_TOM: (ctx, out, t, v) => this.tom(ctx, out, t, v, 240, 150),
      FLOOR_TOM: (ctx, out, t, v) => this.tom(ctx, out, t, v, 140, 80),
      CRASH: (ctx, out, t, v) => this.cymbal(ctx, out, t, v, 5000, 1.4),
      RIDE: (ctx, out, t, v) => this.cymbal(ctx, out, t, v, 7000, 0.6, 0.5),
    };
  }

  private tom(ctx: AudioContext, out: AudioNode, t: number, v: number, f0: number, f1: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.25);
    g.gain.setValueAtTime(0.9 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
  }

  private cymbal(ctx: AudioContext, out: AudioNode, t: number, v: number, freq: number, decay: number, gainMul = 0.6): void {
    const n = ctx.createBufferSource();
    n.buffer = this.noise!;
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainMul * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay * (0.6 + v * 0.4));
    n.connect(f).connect(g).connect(out);
    n.start(t);
    n.stop(t + decay + 0.1);
  }

  /** 사용자 제스처 안에서 한 번 호출. 이후 어디서든 trigger 가능 */
  async ensure(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.padBus = this.ctx.createGain();
      this.padBus.gain.value = this.padMuted ? 0 : 1;
      this.padBus.connect(this.master);
      this.accBus = this.ctx.createGain();
      this.accBus.gain.value = 1;
      this.accBus.connect(this.master);
      this.ctx.addEventListener('statechange', () => {
        for (const l of this.stateListeners) l(this.ctx!.state);
      });
      this.noise = noiseBuffer(this.ctx);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  /** 사운드 세트 교체. null이면 합성음. 다음 타격부터 반영된다 */
  setSoundSet(set: SoundSet | null): void {
    this.set = set;
  }

  get soundSet(): SoundSet | null {
    return this.set;
  }

  /** 샘플 디코드용. ensure() 이전에는 null */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** 반주 재생기가 소스를 연결할 버스. ensure() 이전에는 null */
  get accompanimentBus(): GainNode | null {
    return this.accBus;
  }

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  latency(): LatencyInfo | null {
    if (!this.ctx) return null;
    return {
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: this.ctx.baseLatency * 1000,
      outputLatencyMs: (this.ctx.outputLatency ?? 0) * 1000,
    };
  }

  /** performance.now 기준 시각 → AudioContext 시각(초). getOutputTimestamp 기반이며 컨텍스트가 없으면 0 */
  perfToContextTime(perfMs: number): number {
    if (!this.ctx) return 0;
    const ts = this.ctx.getOutputTimestamp();
    if (ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    return this.ctx.currentTime;
  }

  /** AudioContext 시각(초) → performance.now 기준 시각. 컨텍스트가 없으면 performance.now() */
  contextToPerfTime(ctxTime: number): number {
    if (!this.ctx) return performance.now();
    const ts = this.ctx.getOutputTimestamp();
    if (ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      return ts.performanceTime + (ctxTime - ts.contextTime) * 1000;
    }
    return performance.now();
  }

  /**
   * 패드 소리. whenMs(performance.now 기준)를 주면 그 시각에 맞춰 스케줄, 없으면 즉시.
   * 반환: 실제 스케줄된 performance.now() 기준 시각 (텔레메트리 tAudio).
   */
  trigger(pad: PadId, velocity: number, whenMs?: number): number {
    if (!this.ctx || !this.padBus) return performance.now();
    const ctx = this.ctx;
    const v = Math.pow(Math.max(1, Math.min(127, velocity)) / 127, 1.4);
    const at = whenMs === undefined ? ctx.currentTime : Math.max(ctx.currentTime, this.perfToContextTime(whenMs));
    const sample = this.set?.pads[pad];
    if (sample && this.set) {
      // 타격마다 새 소스·게인 노드. 게인 = 패드 게인 × 키트 트림 × 세기 곡선
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.playbackRate.value = sample.playbackRate;
      const g = ctx.createGain();
      g.gain.value = sample.gain * this.set.masterTrim * v;
      src.connect(g).connect(this.padBus);
      src.start(at);
    } else {
      this.voices[pad](ctx, this.padBus, at, v);
    }
    return this.contextToPerfTime(at);
  }

  /** 메트로놈 클릭. 반환: 실제 예약된 performance.now() 기준 시각(trigger와 같은 계산) */
  click(whenMs: number | undefined, accent: boolean): number {
    if (!this.ctx || !this.master) return performance.now();
    const ctx = this.ctx;
    const at = whenMs === undefined ? ctx.currentTime : Math.max(ctx.currentTime, this.perfToContextTime(whenMs));
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(accent ? 0.35 : 0.2, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + 0.05);
    return this.contextToPerfTime(at);
  }

  /** 패드 소리 음소거. ensure 전에 불러도 값을 기억했다가 컨텍스트 생성 때 적용한다 */
  setPadMuted(muted: boolean): void {
    this.padMuted = muted;
    if (this.padBus) this.padBus.gain.value = muted ? 0 : 1;
  }

  /** AudioContext 상태(running·suspended·interrupted 등) 변경 구독. 해제 함수를 돌려준다 */
  onStateChange(listener: (state: string) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }
}

export const audioEngine = new AudioEngine();
