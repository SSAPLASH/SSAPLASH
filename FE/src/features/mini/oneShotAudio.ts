// 「정적 뒤 한 방」의 음원 재생기 (설계 MODE-006-minigame-oneshot 3절 「음원 재생기」).
// 음원을 받아 풀어 두고, 앞부분(처음부터 정답 위치 직전까지)은 정해진 오디오 시각에, 뒷부분(드럼 한 방과 후렴)은 지금 바로 반주 버스로 튼다.
// 어디서 나눌지는 곡 표가 정하고 길이 검사는 domain이 한다. 여기서는 받기·풀기·예약·멈추기만 한다.
// 리듬 게임의 반주 재생기(audio/Accompaniment)는 끝까지 트는 재생기라 쓰지 않는다. 받고 푸는 순서는 그 파일과 같다.
import { audioEngine } from '@/audio/AudioEngine';

/** 끊을 때 딸깍 소리가 나지 않게 줄이는 시간(초) */
const CUT_FADE_SEC = 0.005;
/** 뒷부분의 끝을 줄여 나가는 시간(초) */
const TAIL_FADE_SEC = 0.8;

/** 음원을 준비하지 못한 까닭: 받지 못함·풀지 못함 */
export type ClipErrorKind = 'fetch' | 'decode';

export class ClipError extends Error {
  readonly kind: ClipErrorKind;
  constructor(kind: ClipErrorKind, message: string) {
    super(message);
    this.name = 'ClipError';
    this.kind = kind;
  }
}

/** 재생기가 오디오 엔진에서 쓰는 것. 테스트에서 가짜로 바꿔 끼운다 */
export interface OneShotEngine {
  readonly context: AudioContext | null;
  readonly accompanimentBus: GainNode | null;
}

export interface OneShotAudioDeps {
  engine?: OneShotEngine;
  fetch?: typeof fetch;
  /** 오디오 컨텍스트가 아직 없을 때 음원을 풀 컨텍스트를 만든다. 넘기지 않으면 소리를 내지 않는 OfflineAudioContext를 쓴다 */
  decoder?: () => Pick<BaseAudioContext, 'decodeAudioData'>;
}

export interface OneShotAudio {
  /** 음원을 받아 풀어 돌려준다. 같은 주소는 다시 받지 않는다. 실패하면 ClipError를 던진다 */
  loadClip(url: string, signal?: AbortSignal): Promise<AudioBuffer>;
  /**
   * 파일 처음부터 정답 위치 직전까지를 그 오디오 시각(초)에 트도록 예약한다.
   * 실제로 시작하는 오디오 시각을 돌려준다(이미 지난 시각이면 지금). 컨텍스트가 돌고 있지 않으면 null
   */
  playHead(buffer: AudioBuffer, startCtxSec: number, answerMs: number): number | null;
  /** 앞부분이 아직 울리고 있으면 줄여 끊고, 정답 위치부터를 지금 바로 튼다. 끝은 줄여 나간다 */
  playTail(buffer: AudioBuffer, answerMs: number, lengthMs: number): void;
  /** 울리는 소리와 예약된 소리를 줄여 모두 멈춘다 */
  stop(): void;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export function createOneShotAudio(deps: OneShotAudioDeps = {}): OneShotAudio {
  const engine = deps.engine ?? audioEngine;
  const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // 음원은 안내 단계(사용자가 아직 아무것도 누르지 않았을 수 있다)에서 받아 푼다. 그때는 오디오 컨텍스트가 없거나 멈춰 있고,
  // 엔진의 ensure()는 사용자 제스처를 기다리느라 끝나지 않는다. 그래서 풀기만 하는 컨텍스트를 따로 쓴다(푼 버퍼는 어느 컨텍스트에서나 틀 수 있다)
  const decoder = deps.decoder ?? (() => new OfflineAudioContext(1, 1, 44100));
  /** 다 받아 푼 음원만 기억한다. 받는 중인 것은 기억하지 않아, 그만둔 받기가 다음 받기를 실패로 만들지 않는다 */
  const clips = new Map<string, AudioBuffer>();
  const voices = new Set<Voice>();

  /** 소스 하나를 반주 버스에 잇는다. 끝나면 목록에서 뺀다 */
  const voice = (ctx: AudioContext, bus: GainNode, buffer: AudioBuffer): Voice => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(bus);
    const v: Voice = { source, gain };
    voices.add(v);
    source.onended = () => {
      voices.delete(v);
      gain.disconnect();
    };
    return v;
  };

  /** 울리는(또는 예약된) 소리를 짧게 줄여 끊는다 */
  const cut = (ctx: AudioContext) => {
    const now = ctx.currentTime;
    for (const v of voices) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + CUT_FADE_SEC);
      try {
        v.source.stop(now + CUT_FADE_SEC);
      } catch {
        // 이미 멈춘 소스다
      }
    }
    voices.clear();
  };

  const load = async (url: string, signal?: AbortSignal): Promise<AudioBuffer> => {
    let data: ArrayBuffer;
    try {
      const res = await doFetch(url, { signal, credentials: 'omit' });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.arrayBuffer();
    } catch (e) {
      // 화면을 벗어나 그만둔 것은 실패로 바꾸지 않고 그대로 넘긴다
      if (signal?.aborted) throw e;
      throw new ClipError('fetch', '음원을 받지 못했습니다');
    }
    try {
      const ctx = engine.context ?? decoder();
      return await ctx.decodeAudioData(data);
    } catch {
      throw new ClipError('decode', '음원을 풀지 못했습니다');
    }
  };

  return {
    async loadClip(url, signal) {
      const cached = clips.get(url);
      if (cached) return cached;
      // 실패한 주소는 기억하지 않는다([다시 시도]가 다시 받게)
      const buffer = await load(url, signal);
      clips.set(url, buffer);
      return buffer;
    },

    playHead(buffer, startCtxSec, answerMs) {
      const ctx = engine.context;
      const bus = engine.accompanimentBus;
      if (!ctx || !bus || ctx.state !== 'running') return null;
      const when = Math.max(ctx.currentTime, startCtxSec);
      const length = Math.max(0, answerMs / 1000);
      const v = voice(ctx, bus, buffer);
      // 정답 위치 직전에서 줄여 끊는다. 원곡의 드럼이 새어 나오지 않게 한다
      v.gain.gain.setValueAtTime(1, when);
      v.gain.gain.setValueAtTime(1, when + Math.max(0, length - CUT_FADE_SEC));
      v.gain.gain.linearRampToValueAtTime(0, when + length);
      v.source.start(when, 0, length);
      return when;
    },

    playTail(buffer, answerMs, lengthMs) {
      const ctx = engine.context;
      const bus = engine.accompanimentBus;
      if (!ctx || !bus || ctx.state !== 'running') return;
      cut(ctx);
      const now = ctx.currentTime;
      const offset = Math.max(0, answerMs / 1000);
      const length = Math.max(0, Math.min(lengthMs / 1000, buffer.duration - offset));
      if (length <= 0) return;
      const v = voice(ctx, bus, buffer);
      v.gain.gain.setValueAtTime(1, now);
      v.gain.gain.setValueAtTime(1, now + Math.max(0, length - TAIL_FADE_SEC));
      v.gain.gain.linearRampToValueAtTime(0, now + length);
      v.source.start(now, offset, length);
    },

    stop() {
      const ctx = engine.context;
      if (!ctx) {
        voices.clear();
        return;
      }
      cut(ctx);
    },
  };
}

/** 앱에 하나뿐인 재생기 */
export const oneShotAudio = createOneShotAudio();
