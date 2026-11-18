// PLAY-06 저지연 사운드. Web Audio로 패드 소리를 낸다.
// 소리 출처는 사운드 세트(audio/soundSets). 세트가 없거나 해당 패드 샘플이 없으면 합성음으로 폴백한다.
import type { PadId } from '@/domain/kit/pads';
import { SAMPLE_FALLBACK, type SamplePad, type SoundSet } from './soundSets';
import { CLOCK_POLL_MS, CLOCK_WAIT_MAX_MS, PRIMED_MIN_WAIT_MS, SOUND_RECENT_MS, clockFlowing, type ClockSample } from '@/domain/time/audioClock';
import type { AudioReading } from '@/domain/time/audioTimeline';
import type { ClickLevel } from '@/domain/time/metronome';

export interface LatencyInfo {
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
}

/**
 * getOutputTimestamp 짝이 현재 시각과 이만큼 넘게 어긋나면 무효로 본다(수십 초 오류만 거르는 폭).
 * 짝으로 계산한 지금 시각은 출력 지연만큼 앞서므로, 이 폭이 출력 지연보다 작으면 정상 짝을 버리고 지연 보정을 잃는다.
 * 블루투스처럼 지연이 1초 가까이 되는 장치도 짝을 쓰도록 3초로 둔다(설계 MODE-001)
 */
const ANCHOR_MAX_SKEW_MS = 3000;
/**
 * 메트로놈 클릭 소리 3단계(설계 MODE-002-MODE-003-metronome-subdivision D4). 음량은 메트로놈 음량에 곱하는 값.
 * 사이 박은 정박이 묻히지 않게 더 낮고 작고 짧다
 */
const CLICK_VOICE: Record<ClickLevel, { hz: number; gain: number; sec: number }> = {
  accent: { hz: 1600, gain: 0.35, sec: 0.04 },
  beat: { hz: 1100, gain: 0.2, sec: 0.04 },
  sub: { hz: 800, gain: 0.12, sec: 0.03 },
};

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

export interface ClockWaitOptions {
  /** 최대 대기(ms). 기본 CLOCK_WAIT_MAX_MS */
  maxMs?: number;
  /** performance.now 같은 시계(테스트 주입) */
  now?: () => number;
  /** ms만큼 기다리는 함수(테스트 주입) */
  sleep?: (ms: number) => Promise<void>;
}

export interface ClockWaitResult {
  /** 기다린 시간(ms) */
  waitedMs: number;
  /** 최대 대기를 넘어 포기했다 */
  timedOut: boolean;
  /** 컨텍스트가 없거나 running이 아니어서 기다리지 않았다 */
  skipped: boolean;
  /** 출력 장치가 쉬고 있을 수 있어 들리지 않는 신호로 먼저 깨웠다 */
  primed: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 패드 소리 전용 버스. 음소거는 여기 게인만 0으로 해 메트로놈 클릭(master 직결)은 남긴다 */
  private padBus: GainNode | null = null;
  /** 반주 전용 버스(master 직결). 패드 음소거와 무관 */
  private accBus: GainNode | null = null;
  private padMuted = false;
  /** 드럼 음량 배수(0~2). 패드 버스 게인에 쓴다 */
  private drumVolume = 1;
  /** 노래 음량 배수(0~1). 반주 버스 게인에 쓴다 */
  private songVolume = 1;
  /** 메트로놈 클릭 음량(0~1) */
  private clickVolume = 1;
  /** 마지막으로 들리는 소리를 예약한 시각(performance.now). 출력 장치가 깨어 있는지 가늠한다 */
  private lastSoundPerf = -Infinity;
  private stateListeners = new Set<(state: string) => void>();
  private noise: AudioBuffer | null = null;
  private voices: Record<PadId, Voice>;
  private set: SoundSet | null = null;
  /** 하이햇 페달이 떼어진(열림) 상태. 상태 추론은 호출자가 하고 여기는 값만 받는다 */
  private hihatOpen = false;

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

  /** 합성 하이햇 열림 보이스: 닫힘과 같은 대역 노이즈에 감쇠를 길게(0.3초 안팎) */
  private hihatOpenVoice(ctx: AudioContext, out: AudioNode, t: number, v: number): void {
    const n = ctx.createBufferSource();
    n.buffer = this.noise!;
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 9000;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + v * 0.1);
    n.connect(f).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.45);
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
      this.padBus.gain.value = this.padMuted ? 0 : this.drumVolume;
      this.padBus.connect(this.master);
      this.accBus = this.ctx.createGain();
      this.accBus.gain.value = this.songVolume;
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
   * 짝으로 계산한 "지금"이 performance.now()와 3초 넘게 어긋나면 같은 순간 읽은 currentTime↔performance.now 짝으로 대체한다
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

  /** 지금의 화면 시계·오디오 시계 값. 컨텍스트가 없거나 running이 아니면 null (곡 도중 멈춤 진단용) */
  clockReading(): { perfMs: number; ctxSec: number } | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    return { perfMs: performance.now(), ctxSec: this.ctx.currentTime };
  }

  /**
   * 오디오 시계가 지금 들리는 시각보다 앞선 정도(ms) = (currentTime − perfToContextTime(지금)) × 1000, 0 이상.
   * 화면 시계 시각으로 소리를 예약하는 곳(전역 메트로놈·박자 맞추기·채보 자동 재생·구간 재생)은 예약 여유에 이 값을 더한다.
   * 더하지 않으면 출력 지연이 여유보다 클 때 바꾼 오디오 시각이 이미 지나 click·fire가 "지금"으로 당긴다
   * (설계 MODE-001 연주 시계를 오디오 시계 하나로 "같은 원인의 나머지 예약 경로"). 컨텍스트가 없거나 running이 아니면 0
   */
  renderAheadMs(): number {
    if (!this.ctx || this.ctx.state !== 'running') return 0;
    const ms = (this.ctx.currentTime - this.perfToContextTime(performance.now())) * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  /**
   * 오디오 시계 읽기(설계 MODE-001 연주 시계를 오디오 시계 하나로 3장). 같은 순간의 performance.now·currentTime·들리는 오디오 시계 시각.
   * 들리는 시각은 perfToContextTime과 같은 기준점(timeAnchor)으로 구함. getOutputTimestamp 짝이 없거나 3초 넘게 어긋나면 currentTime 그대로(출력 지연 보정 없음).
   * 컨텍스트가 없거나 running이 아니면 null
   */
  audioReading(): AudioReading | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const ctx = this.ctx;
    const perfMs = performance.now();
    const ctxSec = ctx.currentTime;
    // 들리는 시각은 perfToContextTime과 같은 기준점(timeAnchor)으로 구한다. 기준이 다르면 화면 시계로 예약하는 소리(채보 자동 재생)와
    // 오디오 시계로 예약하는 반주·클릭이 어긋난다
    const a = this.timeAnchor(ctx);
    return { perfMs, ctxSec, heardCtxSec: a.contextSec + (perfMs - a.perfMs) / 1000 };
  }

  /**
   * 출력 장치를 깨우는 신호: 들리지 않지만 0은 아닌 30Hz. 음량 설정과 무관하게 destination에 바로 잇는다.
   * 반환한 함수로 멈춘다.
   */
  private startPrimer(ctx: AudioContext): () => void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 30;
    g.gain.value = 0.0005;
    o.connect(g).connect(ctx.destination);
    o.start();
    return () => {
      try {
        o.stop();
      } catch {
        // 이미 멈춘 소스
      }
      o.disconnect();
    };
  }

  /**
   * 오디오 시계가 실제로 흐를 때까지 기다린다 (설계 MODE-001 오디오 시계 시작 대기). 시작·재개에서 시계를 움직이기 전에 부른다.
   * 두 가지를 막는다.
   * (1) 출력을 막 깨운 직후(첫 접속 등)에는 running이어도 currentTime이 0.5~1.2초 멈춰 있다.
   * (2) 출력이 30~45초 넘게 조용했으면 장치가 쉬고 있어, 다음 첫 소리가 나기 시작한 직후 오디오 시계가 0.4~0.8초 멈춘다.
   * 어느 쪽이든 그동안 예약한 클릭은 몰리고 한 번만 예약하는 반주는 곡 내내 늦는다.
   * 최근(SOUND_RECENT_MS)에 소리를 낸 적이 없으면 들리지 않는 신호로 장치를 먼저 깨우고 PRIMED_MIN_WAIT_MS 이상 기다린다.
   * 20ms마다 표본을 읽어 domain/time/audioClock.clockFlowing이 참이면 끝낸다. 최대 대기를 넘으면 timedOut으로 끝내고(그냥 시작),
   * 컨텍스트가 없거나 running이 아니면 skipped로 바로 끝낸다. 거절하지 않는다. resume()은 부르지 않는다 — 사용자 제스처 안의 ensure()가 이미 했다.
   */
  async whenClockFlowing(opts: ClockWaitOptions = {}): Promise<ClockWaitResult> {
    const now = opts.now ?? (() => performance.now());
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxMs = opts.maxMs ?? CLOCK_WAIT_MAX_MS;
    const start = now();
    const first = this.ctx;
    if (!first || first.state !== 'running') return { waitedMs: 0, timedOut: false, skipped: true, primed: false };
    const primed = start - this.lastSoundPerf > SOUND_RECENT_MS;
    const stopPrimer = primed ? this.startPrimer(first) : null;
    if (primed) this.lastSoundPerf = start;
    const minMs = primed ? PRIMED_MIN_WAIT_MS : 0;
    const samples: ClockSample[] = [];
    try {
      for (;;) {
        const t = now();
        const ctx = this.ctx;
        if (!ctx || ctx.state !== 'running') return { waitedMs: t - start, timedOut: false, skipped: true, primed };
        const ts = ctx.getOutputTimestamp();
        samples.push({
          perfMs: t,
          ctxSec: ctx.currentTime,
          outPerfMs: ts.performanceTime !== undefined && ts.performanceTime > 0 ? ts.performanceTime : null,
        });
        if (t - start >= minMs && clockFlowing(samples)) return { waitedMs: t - start, timedOut: false, skipped: false, primed };
        if (t - start >= maxMs) return { waitedMs: t - start, timedOut: true, skipped: false, primed };
        await sleep(CLOCK_POLL_MS);
      }
    } finally {
      stopPrimer?.();
    }
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
    return this.fire(pad, velocity, whenMs, null)?.perfMs ?? null;
  }

  /**
   * trigger와 같되 예약을 취소할 수 있는 핸들을 돌려준다(구간 재생 정지용).
   * cancel: 아직 울리지 않았으면 출력 경로를 끊어 소리를 막고, 이미 울렸으면 아무것도 하지 않는다. 예외 없음.
   */
  triggerScheduled(pad: PadId, velocity: number, whenMs: number): { at: number; cancel: () => void } | null {
    return this.scheduleWithGate(pad, velocity, whenMs, undefined);
  }

  /**
   * triggerScheduled와 같되 오디오 시계 시각 ctxSec(초)에 바로 예약한다. 화면 시계를 거치지 않으므로 반주·클릭과 같은 기준에 놓인다
   * (설계 MODE-001, 연주 시계가 도는 동안의 채보 자동 재생). currentTime보다 이르면 지금
   */
  triggerAtContext(pad: PadId, velocity: number, ctxSec: number): { at: number; cancel: () => void } | null {
    return this.scheduleWithGate(pad, velocity, undefined, ctxSec);
  }

  private scheduleWithGate(pad: PadId, velocity: number, whenMs: number | undefined, ctxSec: number | undefined): { at: number; cancel: () => void } | null {
    const ctx = this.ctx;
    if (!ctx || !this.padBus || ctx.state !== 'running') return null;
    const gate = ctx.createGain();
    gate.connect(this.padBus);
    const r = this.fire(pad, velocity, whenMs, gate, ctxSec);
    if (!r) return null;
    return {
      at: r.perfMs,
      cancel: () => {
        try {
          if (ctx.currentTime < r.ctxAt) gate.disconnect();
        } catch {
          // 이미 끊긴 노드
        }
      },
    };
  }

  /** gate가 있으면 padBus 대신 그 노드로 소리를 보낸다(취소용 관문) */
  private fire(
    pad: PadId,
    velocity: number,
    whenMs: number | undefined,
    gate: AudioNode | null,
    ctxSec?: number,
  ): { perfMs: number; ctxAt: number } | null {
    if (!this.ctx || !this.padBus || this.ctx.state !== 'running') return null;
    // 음소거·음량 0이면 출력은 무음이라 장치를 깨우지 못한다
    if (!this.padMuted && this.drumVolume > 0) this.lastSoundPerf = performance.now();
    const ctx = this.ctx;
    const out = gate ?? this.padBus;
    const v = Math.pow(Math.max(1, Math.min(127, velocity)) / 127, 1.4);
    const want = ctxSec !== undefined ? ctxSec : whenMs === undefined ? ctx.currentTime : this.perfToContextTime(whenMs);
    const at = Math.max(ctx.currentTime, want);
    // 샘플이 없으면 폴백 패드의 샘플(게인 0.7배), 그것도 없으면 합성음
    // 하이햇이 열림이면 열림 샘플 → 없으면 합성 열림 보이스(키트 닫힘 샘플로 대신하지 않는다)
    if (pad === 'HIHAT' && this.hihatOpen) {
      const open = this.set?.variants?.HIHAT_OPEN;
      if (open) {
        this.playSample(ctx, out, open, this.set!.masterTrim * v, at);
      } else {
        this.hihatOpenVoice(ctx, out, at, v);
      }
      return { perfMs: this.contextToPerfTime(at), ctxAt: at };
    }
    const own = this.set?.pads[pad];
    const fb = SAMPLE_FALLBACK[pad];
    const sample = own ?? (fb ? this.set?.pads[fb] : undefined);
    const gainMul = own ? 1 : 0.7;
    if (sample && this.set) {
      // 타격마다 새 소스·게인 노드. 게인 = 패드 게인 × 키트 트림 × 세기 곡선
      this.playSample(ctx, out, sample, this.set.masterTrim * v * gainMul, at);
    } else {
      this.voices[pad](ctx, out, at, v);
    }
    return { perfMs: this.contextToPerfTime(at), ctxAt: at };
  }

  private playSample(ctx: AudioContext, out: AudioNode, sample: SamplePad, mul: number, at: number): void {
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = sample.playbackRate;
    const g = ctx.createGain();
    g.gain.value = sample.gain * mul;
    src.connect(g).connect(out);
    src.start(at);
  }

  /** 하이햇 열림 여부. 다음 HIHAT 타격부터 반영된다(울리는 소리는 끊지 않는다) */
  setHihatOpen(open: boolean): void {
    this.hihatOpen = open;
  }

  /** 메트로놈 클릭. 반환: 실제 예약된 performance.now() 기준 시각(trigger와 같은 계산). running이 아니면 null */
  click(whenMs: number | undefined, level: ClickLevel): number | null {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return null;
    const ctx = this.ctx;
    const at = whenMs === undefined ? ctx.currentTime : Math.max(ctx.currentTime, this.perfToContextTime(whenMs));
    this.clickVoice(ctx, this.master, at, level);
    return this.contextToPerfTime(at);
  }

  /**
   * 오디오 시계 시각(초)에 메트로놈 클릭. 화면 시계를 거치지 않으므로 출력 지연이 커져도 예약 시각이 지나지 않는다
   * (설계 MODE-001 연주 시계를 오디오 시계 하나로). 반환: 실제 예약된 오디오 시계 시각. running이 아니면 null
   */
  clickAtContext(ctxSec: number, level: ClickLevel): number | null {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return null;
    const at = Math.max(this.ctx.currentTime, ctxSec);
    this.clickVoice(this.ctx, this.master, at, level);
    return at;
  }

  private clickVoice(ctx: AudioContext, out: AudioNode, at: number, level: ClickLevel): void {
    this.lastSoundPerf = performance.now();
    const v = CLICK_VOICE[level];
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = v.hz;
    g.gain.setValueAtTime(Math.max(0.001, v.gain * this.clickVolume), at);
    g.gain.exponentialRampToValueAtTime(0.001, at + v.sec);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + v.sec + 0.01);
  }

  /** 패드 소리 음소거. ensure 전에 불러도 값을 기억했다가 컨텍스트 생성 때 적용한다 */
  setPadMuted(muted: boolean): void {
    this.padMuted = muted;
    if (this.padBus) this.padBus.gain.value = muted ? 0 : this.drumVolume;
  }

  /** 드럼 음량 배수. 음소거 중이면 0을 유지하고 풀 때 이 값으로 돌아온다. ensure 전에 불러도 기억했다가 적용한다 */
  setDrumVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    this.drumVolume = v;
    if (this.padBus) this.padBus.gain.value = this.padMuted ? 0 : v;
  }

  /** 노래(반주) 음량 배수. ensure 전에 불러도 기억했다가 적용한다 */
  setSongVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    this.songVolume = v;
    if (this.accBus) this.accBus.gain.value = v;
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
