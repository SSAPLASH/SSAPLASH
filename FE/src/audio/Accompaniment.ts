// 반주 재생기(설계 D3·3-3). 긴 오디오를 전부 디코드해 AudioBufferSourceNode로 예약 재생한다.
// 패드·클릭과 같은 AudioContext 시계를 쓰므로 performance.now 시각으로 시작·재개를 예약할 수 있다.
import { playbackPosition, zeroPerfMs } from '@/domain/time/accompanimentClock';
import type { AudioEngine } from './AudioEngine';

export type AccompanimentState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

export class Accompaniment {
  private engine: AudioEngine;
  private buffer: AudioBuffer | null = null;
  private loadedUrl: string | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** 소스가 실제로 울리기 시작하는 performance.now 시각(예약이 늦으면 늦춰진 값) */
  private startPerf = 0;
  private fromMs = 0;
  private positionMs = 0;
  private zeroPerf: number | null = null;
  private _state: AccompanimentState = 'idle';
  /** 소스 재생 배속(구간 재생 0.75× 등). 다음 start부터 적용 */
  private rate = 1;
  /** 오디오 시계 기준 위치 계산용 앵커: 소스 시작 컨텍스트 시각(초)과 그 시각의 반주 위치(ms, 1배 기준 곡 시각 축) */
  private ctxWhen = 0;
  private ctxFromMs = 0;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  get state(): AccompanimentState {
    return this._state;
  }

  get durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0;
  }

  /** 마지막 start·resume의 반주 0초 시각(performance.now). 시작 전이면 null. 세션 startTime과의 차이가 동기 Δ */
  get zeroPerfMs(): number | null {
    return this.zeroPerf;
  }

  /** 서명 URL을 받아 디코드한다. 같은 URL이 이미 디코드돼 있으면 생략한다. 실패하면 state 'error'와 함께 Error를 던진다 */
  async load(url: string, signal?: AbortSignal): Promise<void> {
    if (this.buffer && this.loadedUrl === url) {
      if (this._state === 'idle' || this._state === 'error') this._state = 'ready';
      return;
    }
    this.stop();
    this._state = 'loading';
    try {
      const res = await fetch(url, { signal, credentials: 'omit' });
      if (!res.ok) throw new Error(`반주 파일을 받지 못했습니다 (${res.status})`);
      const data = await res.arrayBuffer();
      const ctx = this.engine.context ?? (await this.engine.ensure());
      const buffer = await ctx.decodeAudioData(data);
      signal?.throwIfAborted();
      this.buffer = buffer;
      this.loadedUrl = url;
      this._state = 'ready';
    } catch (e) {
      this._state = 'error';
      throw e instanceof Error ? e : new Error('반주를 불러오지 못했습니다.');
    }
  }

  /** atPerfMs(performance.now)에 반주의 fromMs 위치가 울리도록 예약한다 */
  start(atPerfMs: number, fromMs = 0): void {
    const ctx = this.engine.context;
    if (!ctx) return;
    this.startAt(this.engine.perfToContextTime(atPerfMs), fromMs);
  }

  /**
   * 오디오 시계 시각 ctxSec(초)에 반주의 fromMs 위치가 울리도록 예약한다. 화면 시계를 거치지 않는다
   * (설계 MODE-001 연주 시계를 오디오 시계 하나로). 연주 시계(PlayClock)가 메트로놈 클릭과 같은 기준으로 쓴다
   */
  startAtContext(ctxSec: number, fromMs = 0): void {
    this.startAt(ctxSec, fromMs);
  }

  private startAt(wantCtxSec: number, fromMs: number): void {
    const bus = this.engine.accompanimentBus;
    const ctx = this.engine.context;
    if (!this.buffer || !bus || !ctx) return;
    this.detach();
    this.fromMs = fromMs;
    this.positionMs = fromMs;
    if (fromMs >= this.durationMs) {
      this._state = 'ready';
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(bus);
    // 이미 지난 시각이면 AudioContext가 즉시 시작한다. 실제 시작 시각을 기록해 동기 Δ에 드러낸다
    const when = Math.max(ctx.currentTime, wantCtxSec);
    this.startPerf = this.engine.contextToPerfTime(when);
    this.zeroPerf = zeroPerfMs(this.startPerf, fromMs);
    this.ctxWhen = when;
    this.ctxFromMs = fromMs;
    src.onended = () => {
      if (this.source !== src) return;
      this.source = null;
      this.positionMs = 0;
      this._state = 'ready';
    };
    src.start(when, fromMs / 1000);
    this.source = src;
    this._state = 'playing';
  }

  /** 소스를 멈추고 위치를 기억한다. 반환: 멈춘 위치(ms). 재생 중이 아니면 기억된 위치 */
  pause(): number {
    if (this._state !== 'playing') return this.positionMs;
    // startPerf는 출력 시각(performance.now 축)이므로 같은 축으로 잰다. ctx.currentTime은 출력보다 출력 지연만큼 앞서 있어 쓰면 재개 위치가 그만큼 당겨진다
    this.positionMs = this.positionAt(performance.now());
    this.detach();
    this._state = 'paused';
    return this.positionMs;
  }

  /** 기억한 위치부터 atPerfMs에 다시 울린다 */
  resume(atPerfMs: number): void {
    if (this._state !== 'paused') return;
    this.start(atPerfMs, this.positionMs);
  }

  /** 소스를 멈추고 위치를 0으로 되돌린다. 디코드한 버퍼는 남는다 */
  stop(): void {
    this.detach();
    this.positionMs = 0;
    if (this._state === 'playing' || this._state === 'paused') this._state = 'ready';
  }

  /** 재생 배속. 다음 start부터 적용하고, 재생 중이면 현재 소스에도 바로 적용한다(위치 계산은 1배 기준) */
  setRate(rate: number): void {
    const next = Number.isFinite(rate) && rate > 0 ? rate : 1;
    // 재생 중이면 지금 위치로 오디오 시계 앵커를 옮겨 둔다(배속이 바뀌기 전 구간을 새 배속으로 계산하지 않도록)
    const anchor = this._state === 'playing' ? this.audioPositionAt(performance.now()) : null;
    if (anchor !== null) {
      this.ctxWhen = this.engine.perfToContextTime(performance.now());
      this.ctxFromMs = anchor;
    }
    this.rate = next;
    if (this.source) this.source.playbackRate.value = this.rate;
  }

  /** perfMs 시점의 반주 위치(ms). 재생 중이면 계산, 일시정지면 멈춘 위치, 그 외 0 */
  positionAt(perfMs: number): number {
    if (this._state === 'playing') return playbackPosition(this.startPerf, this.fromMs, perfMs, this.durationMs);
    if (this._state === 'paused') return this.positionMs;
    return 0;
  }

  /**
   * perfMs 시점의 반주 위치(ms)를 **오디오 시계(AudioContext) 기준**으로 구한다(T2 accDrift용).
   * positionAt은 시작 시각과 performance.now 축으로만 세므로 오디오 장치 시계 드리프트가 드러나지 않는다.
   * 여기서는 perfToContextTime(getOutputTimestamp를 호출 때마다 다시 읽음)으로 그 시점의 컨텍스트 시각을 얻어
   * 시작 컨텍스트 시각과의 차이로 위치를 센다. 배속은 곡 시각(1배) 축으로 환산한다.
   * 재생 중이 아니거나 소스가 아직 시작 전이거나 끝을 넘으면 null.
   */
  audioPositionAt(perfMs: number): number | null {
    if (this._state !== 'playing') return null;
    const elapsedMs = (this.engine.perfToContextTime(perfMs) - this.ctxWhen) * 1000;
    if (elapsedMs < 0) return null;
    const pos = this.ctxFromMs + elapsedMs * this.rate;
    return pos > this.durationMs ? null : pos;
  }

  /** 버퍼까지 버린다 */
  unload(): void {
    this.stop();
    this.buffer = null;
    this.loadedUrl = null;
    this.zeroPerf = null;
    this._state = 'idle';
  }

  /** 종료 이벤트를 떼고 소스를 정지한다 */
  private detach(): void {
    const src = this.source;
    if (!src) return;
    this.source = null;
    src.onended = null;
    try {
      src.stop();
    } catch {
      // 아직 시작 전이거나 이미 끝난 소스
    }
    src.disconnect();
  }
}
