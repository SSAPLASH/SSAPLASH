// 센서 튜닝 값(PLAY-002 센서 튜닝 설계). 코드 상수였던 판정 반경 계수·세기 곡선·입력 시각 보정·앵커 밖 처리를
// 설정값으로 꺼내고, 이를 적용하는 순수 계산을 한곳에 모은다.
// 기본값은 모두 하드웨어(스틱) 도착 전 초안이다 — 실측 후 DEFAULT_SENSOR_TUNING만 고친다.
import { DEFAULT_ANGLE_RANGE, type AngleRange } from './kitMapping';

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
  /** 앵커 반경 = 가장 가까운 다른 앵커 거리 × 이 값 */
  radiusFactor: number;
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

/** 센서 전 초안 [가정]. 하드웨어 실측 후 여기만 갱신한다 */
export const DEFAULT_SENSOR_TUNING: SensorTuning = {
  radiusFactor: 0.55,
  maxRadiusDeg: 22,
  velocity: { minAccelG: 0.8, maxAccelG: 8, gamma: 0.8 },
  sensorOffsetMs: 0,
  outsidePolicy: 'mute',
  angleRange: DEFAULT_ANGLE_RANGE,
};

export interface TuningRange {
  min: number;
  max: number;
  step: number;
}

/** 슬라이더 범위. clampTuning도 이 범위를 쓴다 */
export const TUNING_RANGES = {
  radiusFactor: { min: 0.3, max: 0.8, step: 0.05 },
  maxRadiusDeg: { min: 8, max: 40, step: 1 },
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

/** 기본값과 다른 항목 수(값 9개 기준). 튜닝 패널 헤더 표시용 */
export function countChangedTuning(t: SensorTuning): number {
  const d = DEFAULT_SENSOR_TUNING;
  return [
    t.radiusFactor !== d.radiusFactor,
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
