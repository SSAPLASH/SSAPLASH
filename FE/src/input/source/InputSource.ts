// 입력 소스 공통 인터페이스.
// 키보드·포인터 모의 IMU·BLE 스틱·WebSocket 허브가 모두 같은 StickEvent를 낸다.
// 상위(InputManager)는 소스 종류를 모른 채 이벤트만 받는다.
import type { DeviceRole, DongleLink, InputSourceKind, Pose, SourceState, StickEvent, StickId } from '@/domain/events';
import { ClockEstimate } from '@/input/clockEstimate';

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

/** 표면 정규 좌표(0~1, 왼쪽 위 원점) → 자세 */
export type SurfaceToPose = (nx: number, ny: number) => Pose;

export interface InputSource {
  readonly kind: InputSourceKind;
  readonly label: string;
  readonly state: SourceState;
  /** 사용자 제스처 안에서 호출해야 하는 소스(BLE)가 있다 */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** 사용자 제스처 없이 이전에 허락받은 연결만 조용히 다시 연다. 열 게 없거나 실패하면 끊김으로 두고 던지지 않는다. 지원 안 하면 없음 */
  autoConnect?(): Promise<void>;
  /** 연결이 살아 있어도 전송 계층을 닫고 다시 연다(재연결 시도). 실패해도 던지지 않는다. Web Serial만 구현 */
  reopen?(): Promise<void>;
  subscribe(listener: StickEventListener): () => void;
  onState(listener: StateListener): () => void;
  /** 자세 스트림 켜기/끄기. 캘리브레이션·자유 모드에서 켠다. 지원 안 하면 무시 */
  setPoseStream?(enabled: boolean): void;
  /** 현재 자세를 기준(0,0)으로. 드리프트 리셋 */
  resetPose?(): void;
  /** 진동 명령 (PLAY-07). 지원 안 하면 무시 */
  haptic?(stickId: 0 | 1, strength: number, durationMs: number): void;
  /**
   * 자세를 읽을 입력 표면(캔버스) 연결. 화면 좌표를 쓰는 소스(포인터)만 구현한다. 없으면 무시.
   * toPose를 주면 표면 정규 좌표(0~1) → 자세를 그 함수로 구한다(원근 보기 캔버스). 없으면 각도 범위에 선형으로 편다
   */
  setSurface?(el: HTMLElement | null, toPose?: SurfaceToPose): void;
  /** 명령 바이트를 그대로 스틱에 보낸다. stickId를 생략하면 연결된 전부. 센서 소스만 구현 */
  sendCommand?(bytes: Uint8Array, stickId?: StickId): void;
  /** 센서 시계 → 브라우저 시계 오프셋(ms). 동기화 전이면 null. role 2·3(발)은 동글 소스만 값을 가진다 */
  clockOffsetOf?(role: DeviceRole): number | null;
  /** 전송 계층 통계 */
  transportStats?(): TransportStats;
  /** 동글 링크 상태 구독. 포트가 닫히면 null. 동글을 쓰는 소스(Web Serial)만 구현 */
  onDongle?(listener: (link: DongleLink | null) => void): () => void;
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
 * 주기 SYNC 간격(ms). ClockEstimate의 10초 창에 표본이 10개쯤 들어오게 1초로 둔다(EMB 합의 2026-11-11).
 * 연결·시계 초기화 직후의 연속 5회는 소스마다 따로 보낸다
 */
export const SYNC_INTERVAL_MS = 1000;

/** 센서 시각 u32 µs의 한 주기(2^32 µs)를 ms로 */
export const WRAP_MS = 4294967.296;

/**
 * 센서 시계 ↔ 브라우저 시계 오프셋 (공통 명세서 8-3 시계 동기화).
 * 센서 시각 펼치기는 여기서, 오프셋 추정(최근 창의 최소 왕복 표본 + 천천히 따라가기)은 ClockEstimate가 한다.
 */
export class ClockSync {
  private estimate = new ClockEstimate();
  /** 직전까지 본 가장 큰 펼친 센서 시각(ms). 랩 판정 기준 */
  private lastSensorMs: number | null = null;
  /** 지금까지 더해진 랩 보정(ms) */
  private wrapOffsetMs = 0;

  /**
   * 센서 시각 u32 µs 랩어라운드를 펼친다. 직전보다 주기의 절반 넘게 작아지면 랩으로 보고 주기를 더한다.
   * 반대로 절반 넘게 크면 랩 전에 보낸 늦은 패킷이므로 그 값에만 주기를 뺀다(상태는 유지).
   */
  private unwrap(sensorMs: number): number {
    if (this.lastSensorMs !== null) {
      const lastRaw = this.lastSensorMs - this.wrapOffsetMs;
      if (sensorMs < lastRaw - WRAP_MS / 2) {
        this.wrapOffsetMs += WRAP_MS;
      } else if (sensorMs > lastRaw + WRAP_MS / 2) {
        return sensorMs + this.wrapOffsetMs - WRAP_MS;
      }
    }
    const v = sensorMs + this.wrapOffsetMs;
    if (this.lastSensorMs === null || v > this.lastSensorMs) this.lastSensorMs = v;
    return v;
  }

  /** t0: 요청 보낸 브라우저 시각, t1: 센서가 찍은 시각, t2: 응답 받은 브라우저 시각 */
  addSample(t0: number, t1: number, t2: number): void {
    t1 = this.unwrap(t1);
    this.estimate.add(t2, t2 - t0, (t0 + t2) / 2 - t1); // browser = sensor + offset
  }

  /** 동기화 전이면 "지금 받았다"로 간주. 적용 오프셋을 recvTime까지 옮긴 뒤 환산한다 */
  toBrowserTime(sensorTs: number, recvTime: number): number {
    const t = this.unwrap(sensorTs);
    this.estimate.advance(recvTime);
    const offset = this.estimate.applied;
    return offset === null ? recvTime : t + offset;
  }

  /** 타격 시각 환산에 쓰는 적용 오프셋 */
  get offset(): number | null {
    return this.estimate.applied;
  }

  /** 최근 창이 가리키는 목표 오프셋. 적용 오프셋이 이 값을 따라간다(모니터·진단용) */
  get targetOffset(): number | null {
    return this.estimate.target;
  }

  /** 최근 창 안 최소 왕복(ms) */
  get rtt(): number {
    return this.estimate.minRtt;
  }

  reset(): void {
    this.estimate.reset();
    this.lastSensorMs = null;
    this.wrapOffsetMs = 0;
  }
}
