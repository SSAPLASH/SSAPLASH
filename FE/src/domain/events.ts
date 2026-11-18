// 센서 → 브라우저 이벤트. 공통 명세서 9-1 타격 이벤트 필드명을 그대로 쓴다.
import type { PadId } from '@/domain/kit/pads';

/** 0 = 왼손, 1 = 오른손 */
export type StickId = 0 | 1;

/** 2 = 왼발(하이햇 페달), 3 = 오른발(킥). 페달 보드가 동글에 role 2·3으로 붙는다 */
export type FootId = 2 | 3;

/** 동글 기기 칸(flags role). 손 0·1, 발 2·3 */
export type DeviceRole = StickId | FootId;

/** 스틱 자세. 기준 자세 대비 상대 각도(도). pitch: 위(+)/아래(-), yaw: 왼쪽(-)/오른쪽(+) */
export interface Pose {
  pitch: number;
  yaw: number;
}

export interface StickHitEvent {
  kind: 'hit';
  /** 타격한 손. 페달 타격은 null(손 없음) */
  stickId: StickId | null;
  /** 페달 타격만: 어느 발인지. 있으면 stickId는 null */
  foot?: FootId;
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
  /** 센서 스틱(프로토콜 v0.7)이 판정한 패드. 없으면 undefined, 스틱이 판정 못 했으면(0xFF) null */
  pad?: PadId | null;
  /** 스틱이 계산한 세기 0~127. 센서 스틱 소스만 */
  velocity?: number;
  /** 스틱 판정의 1·2등 패드 거리 차(도). 작을수록 애매. 센서 스틱 소스만 */
  marginDeg?: number;
  /** 스틱이 "판정 애매"로 표시했는지(flags 비트 4). 센서 스틱 소스만 */
  ambiguous?: boolean;
  /** 스틱이 잰 최대 하강 각속도(°/s). 센서 스틱 소스만 */
  peakSpeedDps?: number;
  /** HIT 패킷 seq(u8, 256마다 돈다). 패킷과 판정 결과를 잇는 열쇠. 센서 스틱 소스만 */
  seq?: number;
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
  /** 그 기기가 부팅 뒤 웹 설정을 못 받았다(STATUS 비트 5). connected: true일 때만 의미. 없으면 모름 */
  unconfigured?: boolean;
}

/** 페달 연결·배터리. 손 status와 분리한다. Web Serial 동글 소스만 낸다 */
export interface PedalStatusEvent {
  kind: 'pedalStatus';
  foot: FootId;
  connected: boolean;
  batteryPct?: number;
}

/** 하이햇 페달 밟힘 상태(PEDAL 0x08). closed = 밟음 */
export interface PedalStateEvent {
  kind: 'pedal';
  foot: 2;
  closed: boolean;
  /** 페달 보드 시계 기준(ms). 소스가 브라우저 시계로 환산한다 */
  timestamp: number;
  /** 브라우저가 이벤트를 받은 시각 performance.now() */
  recvTime: number;
}

export type StickEvent = StickHitEvent | StickPoseEvent | StickStatusEvent | PedalStatusEvent | PedalStateEvent;

/**
 * 센서 소스 식별자. 입력 소스 디스크립터의 id와 같다(예: 'pointer', 'ble').
 * 열린 문자열이라 소스를 추가해도 이 타입은 바뀌지 않는다. 'none'(센서 없음)·'keyboard'·'preview'(세팅 화면 톡 치기)·'touch'(화면 패드 터치)는 예약어.
 */
export type SensorId = string;

/**
 * 입력 경로 식별 — 플레이 로그 input_source, 텔레메트리 tags에 기록.
 * 'keyboard'는 리터럴로 남겨 자동완성·비교에 쓴다(매퍼 선택은 이것만 본다). 나머지는 SensorId.
 * 센서가 아닌 예약어: 'keyboard'(키보드), 'preview'(세팅 화면 톡 치기), 'touch'(화면 패드 터치). 판정은 isSensorSource.
 */
export type InputSourceKind = 'keyboard' | (SensorId & Record<never, never>);

/** 센서(IMU 스틱)가 아닌 입력 소스. 센서 시각 오프셋·드리프트 보정·센서 통계·연결 진단의 대상이 아니다 */
export const NON_SENSOR_SOURCES = ['keyboard', 'preview', 'touch'] as const;

/**
 * 센서(IMU 스틱) 소스인가. 키보드·톡 치기·화면 터치와 source가 없는 기록은 센서가 아니다.
 * 'pointer'(마우스 스틱 흉내) 등 그 외 소스는 센서로 본다.
 */
export function isSensorSource(source: InputSourceKind | string | undefined): boolean {
  return source !== undefined && !(NON_SENSOR_SOURCES as readonly string[]).includes(source);
}

/** 발 타격(하이햇 페달·킥)인가. 판정 타이밍 보정에서 스틱 값 대신 킥 값을 쓴다 */
export function isFootHit(hit: { foot?: FootId }): boolean {
  return hit.foot !== undefined;
}

/** 소스별 설정값 하나. 항목 스키마는 입력 소스 디스크립터가 선언한다 */
export type OptionValue = string | number | boolean;

/** 소스 하나의 설정값 묶음. 설정 스토어는 내용을 모르고 그대로 보관한다 */
export type OptionValues = Record<string, OptionValue>;

/** 패드 판정 출처: key 키 매퍼 / stick 스틱 pad 그대로 / chart 채보 후보로 보정 / pose 자세 매퍼 */
export type HitJudgedBy = 'key' | 'stick' | 'chart' | 'pose';

/**
 * 패드 판정까지 끝난 타격. 게임·자유 모드·텔레메트리가 이걸 소비한다.
 * t* 필드는 모두 performance.now() 기준(ms). 구간별 지연 = 차이.
 */
export interface ResolvedHit {
  id: number;
  /** null = 손 없음(페달 타격) */
  stickId: StickId | null;
  /** 페달 타격만: 어느 발인지 */
  foot?: FootId;
  pad: PadId | null;
  /** 타격 시점의 하이햇 페달 상태. null은 모름 */
  hihatClosed?: boolean | null;
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
  /** 스틱이 잰 최대 하강 각속도(°/s). 센서 스틱 타격만 */
  peakSpeedDps?: number;
  /** 스틱 HIT 패킷 seq(u8). 모니터가 패킷과 판정 결과를 묶을 때 쓴다. 센서 스틱 타격만 */
  seq?: number;
  /** 스틱이 판정한 패드(텔레메트리 baselinePad). 비센서 undefined, 스틱이 판정 못 했으면(0xFF) null */
  firmwarePad?: PadId | null;
  /** 센서 시계 기준 타격 시각(ms, 랩 보정). 비센서·미동기 undefined */
  tSensorMs?: number;
  /** 해석 당시 소스 오프셋(브라우저 − 센서, ms). 센서 소스의 미동기는 null, 비센서 undefined */
  clockOffsetMs?: number | null;
  /** 패드 판정 출처 */
  judgedBy: HitJudgedBy;
  /** 판정 근거: 가장 가까운 앵커까지 각도 거리 */
  distanceDeg?: number;
  /** 판정 근거: 그 앵커 반경 안인지(자세 매퍼만) */
  inside?: boolean;
}

/** 입력 소스 연결 상태 (센서 소스 기준. 키보드는 항상 connected) */
export type SourceState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * 동글 링크 상태(Web Serial 동글만). waiting: 포트는 열렸고 LINK를 아직 못 받음(예전 동글 펌웨어 포함),
 * ok: LINK 수신 중(1초 하트비트), stale: LINK가 3초 넘게 끊김(동글 문제)
 */
export type DongleLink = 'waiting' | 'ok' | 'stale';
