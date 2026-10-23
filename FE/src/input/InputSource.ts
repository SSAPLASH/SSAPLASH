// 입력 소스 공통 인터페이스.
// 키보드·포인터 모의 IMU·BLE 스틱·WebSocket 허브가 모두 같은 StickEvent를 낸다.
// 상위(InputManager)는 소스 종류를 모른 채 이벤트만 받는다.
import type { InputSourceKind, SourceState, StickEvent, StickId } from '@/domain/events';

export type { SourceState };

export type StickEventListener = (e: StickEvent) => void;
export type StateListener = (s: SourceState, message?: string) => void;

/** 전송 계층 통계. 모니터가 표시한다 */
export interface TransportStats {
  crcErrors: number;
  resyncCount: number;
  droppedBytes: number;
  reconnects: number;
}

export interface InputSource {
  readonly kind: InputSourceKind;
  readonly label: string;
  readonly state: SourceState;
  /** 사용자 제스처 안에서 호출해야 하는 소스(BLE)가 있다 */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: StickEventListener): () => void;
  onState(listener: StateListener): () => void;
  /** 자세 스트림 켜기/끄기. 캘리브레이션·자유 모드에서 켠다. 지원 안 하면 무시 */
  setPoseStream?(enabled: boolean): void;
  /** 현재 자세를 기준(0,0)으로. 드리프트 리셋 */
  resetPose?(): void;
  /** 진동 명령 (PLAY-07). 지원 안 하면 무시 */
  haptic?(stickId: 0 | 1, strength: number, durationMs: number): void;
  /** 자세를 읽을 입력 표면(캔버스) 연결. 화면 좌표를 쓰는 소스(포인터)만 구현한다. 없으면 무시 */
  setSurface?(el: HTMLElement | null): void;
  /** 명령 바이트를 그대로 스틱에 보낸다. stickId를 생략하면 연결된 전부. 센서 소스만 구현 */
  sendCommand?(bytes: Uint8Array, stickId?: StickId): void;
  /** 센서 시계 → 브라우저 시계 오프셋(ms). 동기화 전이면 null */
  clockOffsetOf?(stickId: StickId): number | null;
  /** 전송 계층 통계 */
  transportStats?(): TransportStats;
}

export abstract class BaseInputSource implements InputSource {
  abstract readonly kind: InputSourceKind;
  abstract readonly label: string;
  private _state: SourceState = 'disconnected';
  private listeners = new Set<StickEventListener>();
  private stateListeners = new Set<StateListener>();

  get state(): SourceState {
    return this._state;
  }

  protected setState(s: SourceState, message?: string): void {
    this._state = s;
    for (const l of this.stateListeners) l(s, message);
  }

  protected emit(e: StickEvent): void {
    for (const l of this.listeners) l(e);
  }

  subscribe(listener: StickEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this._state);
    return () => this.stateListeners.delete(listener);
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
}

/**
 * 센서 시계 ↔ 브라우저 시계 오프셋 추정 (공통 명세서 8-3 시계 동기화).
 * 왕복 지연이 가장 짧았던 샘플을 신뢰한다.
 */
export class ClockSync {
  private offsetMs: number | null = null;
  private bestRtt = Infinity;

  /** t0: 요청 보낸 브라우저 시각, t1: 센서가 찍은 시각, t2: 응답 받은 브라우저 시각 */
  addSample(t0: number, t1: number, t2: number): void {
    const rtt = t2 - t0;
    if (rtt < this.bestRtt) {
      this.bestRtt = rtt;
      this.offsetMs = (t0 + t2) / 2 - t1; // browser = sensor + offset
    }
  }

  /** 동기화 전이면 "지금 받았다"로 간주 */
  toBrowserTime(sensorTs: number, recvTime: number): number {
    return this.offsetMs === null ? recvTime : sensorTs + this.offsetMs;
  }

  get offset(): number | null {
    return this.offsetMs;
  }

  get rtt(): number {
    return this.bestRtt;
  }

  reset(): void {
    this.offsetMs = null;
    this.bestRtt = Infinity;
  }
}
