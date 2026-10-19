// 센서 → 브라우저 이벤트. 공통 명세서 9-1 타격 이벤트 필드명을 그대로 쓴다.
import type { PadId } from './pads';

/** 0 = 왼손, 1 = 오른손 */
export type StickId = 0 | 1;

/** 스틱 자세. 기준 자세 대비 상대 각도(도). pitch: 위(+)/아래(-), yaw: 왼쪽(-)/오른쪽(+) */
export interface Pose {
  pitch: number;
  yaw: number;
}

export interface StickHitEvent {
  kind: 'hit';
  stickId: StickId;
  /** 센서 시계 기준 타격 시각(ms). 키보드·모의 입력은 performance.now() */
  timestamp: number;
  /** 브라우저가 이벤트를 받은 시각 performance.now() */
  recvTime: number;
  /** 피크 가속도 (g) */
  peakAccel: number;
  pitch: number;
  yaw: number;
  /** 타격 직전 ~200ms 6축 샘플 (가속도 3 + 각속도 3). 수집 모드에서만 */
  swingWindow?: Int16Array;
  /** 키보드 소스만: 누른 키의 KeyboardEvent.code. 패드는 키 매퍼가 정한다 */
  keyCode?: string;
}

export interface StickPoseEvent {
  kind: 'pose';
  stickId: StickId;
  timestamp: number;
  pitch: number;
  yaw: number;
}

export interface StickStatusEvent {
  kind: 'status';
  stickId: StickId;
  connected: boolean;
  batteryPct?: number;
  rssi?: number;
  firmware?: string;
}

export type StickEvent = StickHitEvent | StickPoseEvent | StickStatusEvent;

/** 입력 경로 식별 — 플레이 로그 input_source, 텔레메트리 tags에 기록 */
export type InputSourceKind = 'keyboard' | 'pointer' | 'ble' | 'websocket' | 'devicemotion';

/**
 * 패드 판정까지 끝난 타격. 게임·자유 모드·텔레메트리가 이걸 소비한다.
 * t* 필드는 모두 performance.now() 기준(ms). 구간별 지연 = 차이.
 */
export interface ResolvedHit {
  id: number;
  stickId: StickId;
  pad: PadId | null;
  /** 0~127 */
  velocity: number;
  /** 센서 타격 시각을 브라우저 시계로 환산한 값 */
  tHit: number;
  tRecv: number;
  tResolved: number;
  /** 오디오 스케줄 시각. 사운드 엔진이 채운다 */
  tAudio?: number;
  source: InputSourceKind;
  pose: Pose;
  peakAccel: number;
  /** 판정 근거: 가장 가까운 앵커까지 각도 거리 */
  distanceDeg?: number;
}

/** 입력 소스 연결 상태 (센서 소스 기준. 키보드는 항상 connected) */
export type SourceState = 'disconnected' | 'connecting' | 'connected' | 'error';
