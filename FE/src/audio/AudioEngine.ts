// PLAY-06 저지연 사운드. Web Audio로 패드 소리를 낸다.
// 소리 출처는 사운드 세트(audio/soundSets). 세트가 없거나 해당 패드 샘플이 없으면 합성음으로 폴백한다.
import type { PadId } from '@/domain/pads';
import { SAMPLE_FALLBACK, type SoundSet } from './soundSets';

export interface LatencyInfo {
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
}

/** getOutputTimestamp 짝이 현재 시각과 이만큼 넘게 어긋나면 무효로 본다(수십 초 오류만 거르는 폭) */
const ANCHOR_MAX_SKEW_MS = 1000;

/** 안전 리미터: 이 크기(약 −2dBFS)까지는 그대로 통과시키고, 그 위만 1.0 아래로 부드럽게 눌러 클리핑을 막는다 */
const LIMIT_KNEE = 0.8;
/** 리미터가 받는 입력 범위(±배). 그 밖은 1.0으로 고정된다(+12dB까지 부드럽게 처리) */
const LIMIT_RANGE = 4;

/**
 * 소프트 리미터 곡선(WaveShaper용). WaveShaper는 입력 −1..1을 곡선 양 끝에 대응시키므로
 * 앞단에서 1/LIMIT_RANGE로 줄인 신호를 받아 원래 크기로 되돌린 값을 낸다.
 * DynamicsCompressorNode는 Chrome에서 6ms 지연과 문턱 아래 3~4dB 감쇠가 있어 쓰지 않는다(2026-11-03 측정).
 */
export function softLimitCurve(n = 4097): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * LIMIT_RANGE;
    const a = Math.abs(x);
    const y = a <= LIMIT_KNEE ? a : LIMIT_KNEE + (1 - LIMIT_KNEE) * Math.tanh((a - LIMIT_KNEE) / (1 - LIMIT_KNEE));
    c[i] = Math.sign(x) * y;
  }
  return c;
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
  /** 메트로놈 클릭 음량(0~1) */
  private clickVolume = 1;
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
      SMALL_TOM: (ctx, out, t, v) => this.tom(ctx, out, t, v, 240, 150),
      MID_TOM: (ctx, out, t, v) => this.tom(ctx, out, t, v, 190, 110),
      HIHAT_PEDAL: (ctx, out, t, v) => {
        const n = ctx.createBufferSource();
        n.buffer = this.noise!;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 9000;
        f.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3 * v, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        n.connect(f).connect(g).connect(out);
        n.start(t);
        n.stop(t + 0.1);
      },
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
      // master → 입력 축소 → 소프트 리미터(지연 0) → 출력
      const limitIn = this.ctx.createGain();
      limitIn.gain.value = 1 / LIMIT_RANGE;
      const limiter = this.ctx.createWaveShaper();
      limiter.curve = softLimitCurve();
      limiter.oversample = 'none';
      this.master.connect(limitIn).connect(limiter).connect(this.ctx.destination);
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

  /**
   * 시각 변환 기준점 (contextSec ↔ perfMs). getOutputTimestamp 짝이 유효하면 그것을 쓴다.
   * 컨텍스트가 아직 출력한 적 없으면(suspended, resume 직후) 브라우저가 0·오래된 값을 주므로,
   * 짝으로 계산한 "지금"이 performance.now()와 1초 넘게 어긋나면 같은 순간 읽은 currentTime↔performance.now 짝으로 대체한다
   * (출력 지연 보정은 잃지만 수십 초 오차는 사라진다).
   */
  private timeAnchor(ctx: AudioContext): { contextSec: number; perfMs: number } {
    const nowPerf = performance.now();
    const ts = ctx.getOutputTimestamp();
    if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      const impliedNow = ts.performanceTime + (ctx.currentTime - ts.contextTime) * 1000;
      if (Math.abs(impliedNow - nowPerf) <= ANCHOR_MAX_SKEW_MS) {
        return { contextSec: ts.contextTime, perfMs: ts.performanceTime };
      }
    }
    return { contextSec: ctx.currentTime, perfMs: nowPerf };
  }

  /** performance.now 기준 시각 → AudioContext 시각(초). 컨텍스트가 없으면 0 */
  perfToContextTime(perfMs: number): number {
    if (!this.ctx) return 0;
    const a = this.timeAnchor(this.ctx);
    return a.contextSec + (perfMs - a.perfMs) / 1000;
  }

  /** AudioContext 시각(초) → performance.now 기준 시각. 컨텍스트가 없으면 performance.now() */
  contextToPerfTime(ctxTime: number): number {
    if (!this.ctx) return performance.now();
    const a = this.timeAnchor(this.ctx);
    return a.perfMs + (ctxTime - a.contextSec) * 1000;
  }

  /**
   * 패드 소리. whenMs(performance.now 기준)를 주면 그 시각에 맞춰 스케줄, 없으면 즉시.
   * 반환: 실제 스케줄된 performance.now() 기준 시각 (텔레메트리 tAudio).
   * 컨텍스트가 없거나 running이 아니면 소리가 나지 않으므로 예약하지 않고 null.
   */
  trigger(pad: PadId, velocity: number, whenMs?: number): number | null {
    if (!this.ctx || !this.padBus || this.ctx.state !== 'running') return null;
    const ctx = this.ctx;
    const v = Math.pow(Math.max(1, Math.min(127, velocity)) / 127, 1.4);
    const at = whenMs === undefined ? ctx.currentTime : Math.max(ctx.currentTime, this.perfToContextTime(whenMs));
    // 샘플이 없으면 폴백 패드의 샘플(게인 0.7배), 그것도 없으면 합성음
    const own = this.set?.pads[pad];
    const fb = SAMPLE_FALLBACK[pad];
    const sample = own ?? (fb ? this.set?.pads[fb] : undefined);
    const gainMul = own ? 1 : 0.7;
    if (sample && this.set) {
      // 타격마다 새 소스·게인 노드. 게인 = 패드 게인 × 키트 트림 × 세기 곡선
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.playbackRate.value = sample.playbackRate;
      const g = ctx.createGain();
      g.gain.value = sample.gain * this.set.masterTrim * v * gainMul;
      src.connect(g).connect(this.padBus);
      src.start(at);
    } else {
      this.voices[pad](ctx, this.padBus, at, v);
    }
    return this.contextToPerfTime(at);
  }

  /** 메트로놈 클릭. 반환: 실제 예약된 performance.now() 기준 시각(trigger와 같은 계산). running이 아니면 null */
  click(whenMs: number | undefined, accent: boolean): number | null {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return null;
    const ctx = this.ctx;
    const at = whenMs === undefined ? ctx.currentTime : Math.max(ctx.currentTime, this.perfToContextTime(whenMs));
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(Math.max(0.001, (accent ? 0.35 : 0.2) * this.clickVolume), at);
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

  /** 메트로놈 클릭 음량(0~1). 다음 클릭부터 적용 */
  setClickVolume(v: number): void {
    this.clickVolume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1));
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }
}

export const audioEngine = new AudioEngine();
