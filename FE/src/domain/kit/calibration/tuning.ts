// 센서 튜닝 값(PLAY-002 센서 튜닝 설계). 코드 상수였던 판정 반경 계수·세기 곡선·입력 시각 보정·앵커 밖 처리를
// 설정값으로 꺼내고, 이를 적용하는 순수 계산을 한곳에 모은다.
// 기본값은 모두 하드웨어(스틱) 도착 전 초안이다 — 실측 후 DEFAULT_SENSOR_TUNING만 고친다.
import { DEFAULT_ANGLE_RANGE, type AngleRange } from '@/domain/kit/kitMapping';

/** 피크 가속도 → 벨로시티(0~127) 변환 파라미터 (공통 설계 3-6) */
export interface VelocityCurve {
  /** 이 가속도(g) 이상은 127 */
  maxAccelG: number;
  /** 이 가속도(g) 이하는 1 */
  minAccelG: number;
  /** 1 = 선형, <1 = 약한 타격을 키움 */
  gamma: number;
}

/** 앵커 반경 밖 센서 타격 처리: mute = 판정 없음(무음), nearest = 가장 가까운 앵커 패드 */
export type OutsidePolicy = 'mute' | 'nearest';

export interface SensorTuning {
  /** 앵커 반경 = 같은 손의 가장 가까운 다른 앵커까지 각도 × 이 값 */
  radiusFactor: number;
  /** 반경 하한 (도). 이웃이 가까워도 이만큼은 받아 준다(PLAY-004 D8) */
  minRadiusDeg: number;
  /** 반경 상한 (도) */
  maxRadiusDeg: number;
  velocity: VelocityCurve;
  /** 센서 타격 시각에 더하는 값 (ms). 키보드 타격에는 더하지 않는다 */
  sensorOffsetMs: number;
  outsidePolicy: OutsidePolicy;
  /** 화면 가로·세로 전체가 몇 도의 팔 움직임인지. 배치 → 판정 프로필 변환과 포인터 모의 IMU가 같이 쓴다 */
  angleRange: AngleRange;
}

/** clampTuning·setTuning이 받는 부분 튜닝(velocity·angleRange도 일부만 가능) */
export type PartialTuning = Partial<Omit<SensorTuning, 'velocity' | 'angleRange'>> & {
  velocity?: Partial<VelocityCurve>;
  angleRange?: Partial<AngleRange>;
};

/** 반경 기본값은 EMB 실측(2026-11-05 메일, ×0.6 · 15~35°). 11/6 7패드 통합 테스트 뒤 조정한다(PLAY-004 D8) */
export const DEFAULT_SENSOR_TUNING: SensorTuning = {
  radiusFactor: 0.6,
  minRadiusDeg: 15,
  maxRadiusDeg: 35,
  velocity: { minAccelG: 0.8, maxAccelG: 8, gamma: 0.8 },
  sensorOffsetMs: 0,
  outsidePolicy: 'mute',
  angleRange: DEFAULT_ANGLE_RANGE,
};

/** 유저별 최소 타격 세기(PLAY-004 ③): 보정 타격 peakSpeedDps 중앙값 × 비율, 하한~기본값으로 자른다. 표본이 모자라면 바꾸지 않는다 */
export const MIN_PEAK_RATIO = 0.4;
export const MIN_PEAK_FLOOR_DPS = 250;
/** 펌웨어 기본값(°/s). 저장값이 없을 때 보내는 값이자 상한 */
export const MIN_PEAK_DEFAULT_DPS = 400;
export const MIN_PEAK_MIN_SAMPLES = 6;

export interface TuningRange {
  min: number;
  max: number;
  step: number;
}

/** 슬라이더 범위. clampTuning도 이 범위를 쓴다 */
export const TUNING_RANGES = {
  radiusFactor: { min: 0.3, max: 0.8, step: 0.05 },
  minRadiusDeg: { min: 8, max: 30, step: 1 },
  maxRadiusDeg: { min: 8, max: 45, step: 1 },
  minAccelG: { min: 0.2, max: 4, step: 0.1 },
  maxAccelG: { min: 2, max: 32, step: 0.5 },
  gamma: { min: 0.3, max: 2, step: 0.05 },
  sensorOffsetMs: { min: -150, max: 150, step: 5 },
  angleRange: {
    yawDeg: { min: 20, max: 120, step: 1 },
    pitchDeg: { min: 10, max: 80, step: 1 },
  },
} satisfies Record<string, TuningRange | Record<string, TuningRange>>;

/** maxAccelG는 minAccelG보다 최소 이만큼 커야 한다 */
const MIN_ACCEL_GAP_G = 0.5;

/** 피크 가속도(g) → 벨로시티 1~127 정수. min 이하 1, max 이상 127 */
export function accelToVelocity(peakAccel: number, c: VelocityCurve): number {
  const n = Math.min(1, Math.max(0, (peakAccel - c.minAccelG) / (c.maxAccelG - c.minAccelG)));
  return Math.max(1, Math.round(Math.pow(n, c.gamma) * 127));
}

function clamp(v: number, r: TuningRange): number {
  return Math.min(r.max, Math.max(r.min, v));
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 부분 튜닝을 슬라이더 범위 안으로 자른다(저장 파일 손상 등 방어).
 * 숫자가 아닌 값은 버린다. 이번 입력 안에서 maxAccelG ≤ minAccelG면 maxAccelG를 minAccelG + 0.5로 올린다.
 */
export function clampTuning(partial: PartialTuning): PartialTuning {
  const out: PartialTuning = {};
  if (isNum(partial.radiusFactor)) out.radiusFactor = clamp(partial.radiusFactor, TUNING_RANGES.radiusFactor);
  if (isNum(partial.minRadiusDeg)) out.minRadiusDeg = clamp(partial.minRadiusDeg, TUNING_RANGES.minRadiusDeg);
  if (isNum(partial.maxRadiusDeg)) out.maxRadiusDeg = clamp(partial.maxRadiusDeg, TUNING_RANGES.maxRadiusDeg);
  if (isNum(partial.sensorOffsetMs)) out.sensorOffsetMs = clamp(partial.sensorOffsetMs, TUNING_RANGES.sensorOffsetMs);
  if (partial.outsidePolicy === 'mute' || partial.outsidePolicy === 'nearest') out.outsidePolicy = partial.outsidePolicy;
  if (partial.angleRange) {
    const a: Partial<AngleRange> = {};
    if (isNum(partial.angleRange.yawDeg)) a.yawDeg = clamp(partial.angleRange.yawDeg, TUNING_RANGES.angleRange.yawDeg);
    if (isNum(partial.angleRange.pitchDeg)) a.pitchDeg = clamp(partial.angleRange.pitchDeg, TUNING_RANGES.angleRange.pitchDeg);
    out.angleRange = a;
  }
  if (partial.velocity) {
    const v: Partial<VelocityCurve> = {};
    if (isNum(partial.velocity.minAccelG)) v.minAccelG = clamp(partial.velocity.minAccelG, TUNING_RANGES.minAccelG);
    if (isNum(partial.velocity.maxAccelG)) v.maxAccelG = clamp(partial.velocity.maxAccelG, TUNING_RANGES.maxAccelG);
    if (isNum(partial.velocity.gamma)) v.gamma = clamp(partial.velocity.gamma, TUNING_RANGES.gamma);
    if (v.minAccelG !== undefined && v.maxAccelG !== undefined && v.maxAccelG <= v.minAccelG) {
      v.maxAccelG = v.minAccelG + MIN_ACCEL_GAP_G;
    }
    out.velocity = v;
  }
  return out;
}

/**
 * 부분 튜닝을 현재 값에 병합한다: clampTuning을 거친 뒤, 병합 결과의 max ≤ min이면 max를 min + 0.5로 올린다.
 * (min만 올려 기존 max와 겹치는 경우도 여기서 잡는다)
 */
export function mergeTuning(base: SensorTuning, partial: PartialTuning): SensorTuning {
  const { velocity: v, angleRange: a, ...rest } = clampTuning(partial);
  const velocity = { ...base.velocity, ...v };
  if (velocity.maxAccelG <= velocity.minAccelG) velocity.maxAccelG = velocity.minAccelG + MIN_ACCEL_GAP_G;
  const angleRange = { ...base.angleRange, ...a };
  return { ...base, ...rest, velocity, angleRange };
}

/** 기본값과 다른 항목 수(값 10개 기준). 튜닝 패널 헤더 표시용 */
export function countChangedTuning(t: SensorTuning): number {
  const d = DEFAULT_SENSOR_TUNING;
  return [
    t.radiusFactor !== d.radiusFactor,
    t.minRadiusDeg !== d.minRadiusDeg,
    t.maxRadiusDeg !== d.maxRadiusDeg,
    t.velocity.minAccelG !== d.velocity.minAccelG,
    t.velocity.maxAccelG !== d.velocity.maxAccelG,
    t.velocity.gamma !== d.velocity.gamma,
    t.sensorOffsetMs !== d.sensorOffsetMs,
    t.outsidePolicy !== d.outsidePolicy,
    t.angleRange.yawDeg !== d.angleRange.yawDeg,
    t.angleRange.pitchDeg !== d.angleRange.pitchDeg,
  ].filter(Boolean).length;
}

/**
 * 스틱 판정이 "애매"하다고 보는 1·2등 패드 거리 차(도). 펌웨어 `?` 표시 기준과 같다.
 * 이 값 미만이면 채보 후보로 보정할 수 있다. 실측 뒤 슬라이더 여부 재검토(설계 U2).
 */
export const AMBIGUOUS_MARGIN_DEG = 10;

// 방위각 드리프트 보정 임계값. 실측(패드 반경 15~35°) 뒤 조정한다(설계 PLAY-002 yaw drift U1).
/** 이 값(도) 이상 밀렸을 때만 보정 */
export const DRIFT_MIN_DEG = 6;
/** 오차 중앙절대편차가 이 값(도)을 넘으면 드리프트가 아니라 가장자리 타격으로 보고 보정하지 않음 */
export const DRIFT_MAX_SPREAD_DEG = 5;
/** 판정에 필요한 최소 샘플 수 */
export const DRIFT_MIN_SAMPLES = 8;
/** 스틱별 샘플 링 크기 */
export const DRIFT_WINDOW = 12;
/** 송신 뒤 재송신 금지 시간(ms) */
export const DRIFT_COOLDOWN_MS = 10_000;
/** 한 번 자동 보정으로 움직이는 최대 각도(도). 남은 오차는 다음 표본 모음에서 다시 본다 */
export const DRIFT_MAX_STEP_DEG = 8;
/** 직전 자동 보정과 부호가 반대인 보정이 연달아 이 횟수만큼 나오려 하면 그 손의 자동 보정을 멈춘다 */
export const DRIFT_FLIP_LIMIT = 2;
