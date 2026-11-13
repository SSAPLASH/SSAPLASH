// 텔레메트리 wire 형식과 변환(순수 함수). 설계 3-1~3-3, 합의 문서(MONITOR-001 FE 계약확인).
// 시각 측정·전송·큐는 모르고, 받은 값을 BE 계약에 맞게 다듬을 뿐이다.
import type { ResolvedHit, StickId } from '@/domain/events';
import type { Judgement } from '@/domain/play/judgement';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { isSensorSource } from '@/domain/events';

export const SCHEMA_VERSION = 1;

/** 연주 세션 mode. 세션 밖은 null. FREE·TEMPO는 해당 모드 세션 이벤트가 생기면 추가한다 */
export type TelemetryMode = 'RHYTHM' | 'SHEET' | null;

export interface HitTags {
  source: string;
  clockSynced: boolean;
  firmware?: string;
}

export interface StatusTags {
  source: string;
  connected: boolean;
  firmware?: string;
}

/** 두 종류가 모든 필드를 가진다(해당 없는 값은 null). 필드 이름은 BE 계약 그대로 */
interface EventBase {
  /** ISO-8601 UTC */
  time: string;
  stickId: StickId | null;
  pad: PadId | null;
  baselinePad: PadId | null;
  predictedPad: PadId | null;
  judgement: Judgement | null;
  deltaMs: number | null;
  velocity: number | null;
  /** 랩 보정한 센서 시각, 정수 µs */
  tSensor: number | null;
  tRecv: number | null;
  tJudge: number | null;
  tAudio: number | null;
  clockOffsetMs: number | null;
  packetLoss: number | null;
  batteryPct: number | null;
}

export interface HitEvent extends EventBase {
  kind: 'HIT';
  tags: HitTags;
}

export interface StatusEvent extends EventBase {
  kind: 'STATUS';
  stickId: StickId;
  tags: StatusTags;
}

export type TelemetryEvent = HitEvent | StatusEvent;

export interface TelemetryBatch {
  schemaVersion: typeof SCHEMA_VERSION;
  sessionId: string;
  mode: TelemetryMode;
  events: TelemetryEvent[];
}

/** tags.source 길이 상한(BE) */
export const SOURCE_MAX_LEN = 32;

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `performance.timeOrigin + 단조 시계(ms)` → ISO-8601 UTC. 유효한 시각이 아니면 null */
export function toIsoTime(perfMs: number, timeOrigin: number): string | null {
  const t = timeOrigin + perfMs;
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function clampSource(source: string): string {
  return source.length > SOURCE_MAX_LEN ? source.slice(0, SOURCE_MAX_LEN) : source;
}

function withFirmware<T extends { source: string; firmware?: string }>(tags: T, firmware: string | null | undefined): T {
  if (firmware) tags.firmware = firmware;
  return tags;
}

export interface HitEventInput {
  hit: ResolvedHit;
  /** 같은 hitId의 diag judged. 짝이 없으면 null */
  judgement: Judgement | null;
  /** judged의 deltaMs. PERFECT·GOOD일 때만 쓰인다 */
  deltaMs: number | null;
  /** 해당 스틱이 마지막 STATUS로 알린 펌웨어 버전("1.0") */
  firmware?: string | null;
  /** 이벤트 시각(performance.now() 기준 ms). collector가 hit.tRecv를 넘긴다 */
  atMs: number;
  /** performance.timeOrigin (페이지 로드 때 고정) */
  timeOrigin: number;
}

/**
 * ResolvedHit → HIT 이벤트. BE 필수값(time·tRecv·tJudge·velocity)을 만들 수 없으면 null(보내지 않는다).
 * - stickId: 센서 소스이고 스틱 패드(또는 패드 없음)일 때만. 키보드·KICK·HIHAT_PEDAL은 null
 * - tAudio: 없거나 tJudge보다 작으면 null
 * - 센서 시각·오프셋은 미동기·비센서면 null, clockSynced는 오프셋이 있는지
 */
export function hitToEvent(input: HitEventInput): HitEvent | null {
  const { hit } = input;
  const time = toIsoTime(input.atMs, input.timeOrigin);
  const tRecv = finiteOrNull(hit.tRecv);
  const tJudge = finiteOrNull(hit.tResolved);
  const velocity = finiteOrNull(hit.velocity);
  if (time === null || tRecv === null || tJudge === null || velocity === null) return null;

  const isSensor = isSensorSource(hit.source);
  const stickPad = hit.pad === null || PAD_META[hit.pad].stick;
  const clockOffsetMs = isSensor ? finiteOrNull(hit.clockOffsetMs) : null;
  const tSensorMs = clockOffsetMs === null ? null : finiteOrNull(hit.tSensorMs);
  const tSensor = tSensorMs === null ? null : Math.round(tSensorMs * 1000);
  const tAudioRaw = finiteOrNull(hit.tAudio);
  const timed = input.judgement === 'PERFECT' || input.judgement === 'GOOD';

  return {
    time,
    kind: 'HIT',
    stickId: isSensor && stickPad ? hit.stickId : null,
    pad: hit.pad,
    baselinePad: isSensor ? (hit.firmwarePad ?? null) : null,
    predictedPad: hit.pad,
    judgement: input.judgement,
    deltaMs: timed ? finiteOrNull(input.deltaMs) : null,
    velocity: Math.min(127, Math.max(0, Math.round(velocity))),
    tSensor: tSensor !== null && tSensor >= 0 ? tSensor : null,
    tRecv,
    tJudge,
    tAudio: tAudioRaw !== null && tAudioRaw >= tJudge ? tAudioRaw : null,
    clockOffsetMs,
    packetLoss: null,
    batteryPct: null,
    tags: withFirmware({ source: clampSource(hit.source), clockSynced: clockOffsetMs !== null }, input.firmware),
  };
}

export interface StatusEventInput {
  stickId: StickId;
  connected: boolean;
  source: string;
  /** 0~100 정수만 인정. 0xFF(측정 불가)는 호출자가 null로 넘긴다 */
  batteryPct: number | null;
  /** 0~1. 측정 불가면 null */
  packetLoss: number | null;
  firmware?: string | null;
  atMs: number;
  timeOrigin: number;
}

/** STATUS 이벤트. 시각을 만들 수 없으면 null */
export function statusToEvent(input: StatusEventInput): StatusEvent | null {
  const time = toIsoTime(input.atMs, input.timeOrigin);
  if (time === null) return null;
  const battery = finiteOrNull(input.batteryPct);
  const loss = finiteOrNull(input.packetLoss);
  return {
    time,
    kind: 'STATUS',
    stickId: input.stickId,
    pad: null,
    baselinePad: null,
    predictedPad: null,
    judgement: null,
    deltaMs: null,
    velocity: null,
    tSensor: null,
    tRecv: null,
    tJudge: null,
    tAudio: null,
    clockOffsetMs: null,
    packetLoss: loss === null ? null : Math.min(1, Math.max(0, loss)),
    batteryPct: battery === null ? null : Math.min(100, Math.max(0, Math.round(battery))),
    tags: withFirmware({ source: clampSource(input.source), connected: input.connected }, input.firmware),
  };
}

/** 요청 외피. 한 배치는 같은 sessionId·mode만 담는다(호출자 책임) */
export function buildBatch(sessionId: string, mode: TelemetryMode, events: TelemetryEvent[]): TelemetryBatch {
  return { schemaVersion: SCHEMA_VERSION, sessionId, mode, events };
}
