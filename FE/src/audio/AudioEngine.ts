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

  /**
   * 패드 소리. whenMs(performance.now 기준)를 주면 그 시각에 맞춰 스케줄, 없으면 즉시.
   * 반환: 실제 스케줄된 performance.now() 기준 시각 (텔레메트리 tAudio).
   */
  trigger(pad: PadId, velocity: number, whenMs?: number): number {
    if (!this.ctx || !this.master) return performance.now();
    const ctx = this.ctx;
    const v = Math.pow(Math.max(1, Math.min(127, velocity)) / 127, 1.4);
    let at = ctx.currentTime;
    const ts = ctx.getOutputTimestamp();
    if (whenMs !== undefined && ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      at = Math.max(ctx.currentTime, ts.contextTime + (whenMs - ts.performanceTime) / 1000);
    }
    const sample = this.set?.pads[pad];
    if (sample && this.set) {
      // 타격마다 새 소스·게인 노드. 게인 = 패드 게인 × 키트 트림 × 세기 곡선
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.playbackRate.value = sample.playbackRate;
      const g = ctx.createGain();
      g.gain.value = sample.gain * this.set.masterTrim * v;
      src.connect(g).connect(this.master);
      src.start(at);
    } else {
      this.voices[pad](ctx, this.master, at, v);
    }
    if (ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      return ts.performanceTime + (at - ts.contextTime) * 1000;
    }
    return performance.now();
  }

  /** 메트로놈 클릭 */
  click(whenMs: number | undefined, accent: boolean): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    let at = ctx.currentTime;
    const ts = ctx.getOutputTimestamp();
    if (whenMs !== undefined && ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      at = Math.max(ctx.currentTime, ts.contextTime + (whenMs - ts.performanceTime) / 1000);
    }
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(accent ? 0.35 : 0.2, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + 0.05);
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }
}

export const audioEngine = new AudioEngine();
