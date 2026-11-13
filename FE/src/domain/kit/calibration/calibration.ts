// 캘리브레이션 프로필과 기준선 패드 판정(PLAY-003·PLAY-004).
// 패드마다 "중심 자세(앵커)"를 잡고, 경계는 앵커 간 거리로 자동 계산한다.
// 거리·평균은 방향 벡터(단위 벡터)로 계산해 방위각 ±180° 끊김이 없고 펌웨어 판정과 같은 기준이다(PLAY-004 D3).
import type { PadId } from '@/domain/kit/pads';
import type { Pose, SensorId, StickId } from '@/domain/events';
import { DEFAULT_SENSOR_TUNING } from './tuning';

/** 스틱에 보낸 패드 표의 적용 상태. 입력 계층(padTableSync)이 만들고 store가 보관한다 */
export interface PadTableStatus {
  sent: number;
  /** PARAM_ACK_PAD_TABLE의 value. 확인 창 안에 못 받았으면 null */
  acked: number | null;
  /** 전송 시각(performance.now) */
  at: number;
  /** 마지막 전송 대상 손. 양손 전체면 null */
  target: StickId | null;
}

/** 스틱 방위각 드리프트 감지·SET_YAW_OFFSET 보정 상태(스틱별). 입력 계층(yawDriftMonitor)이 만들고 store가 보관한다 */
export interface YawDriftStatus {
  /** 지금 스틱에 적용돼 있다고 FE가 아는 오프셋(도). RESET_POSE 뒤 0 */
  appliedDeg: number;
  /** 링에 쌓인 샘플 수(0~12) */
  samples: number;
  /** 마지막 판정 중앙값(도). 샘플이 모자라면 null */
  lastErrorDeg: number | null;
  /** 마지막 송신 시각(performance.now). 없으면 null */
  lastSentAt: number | null;
  /** 마지막 송신의 PARAM_ACK 0x21 확인 여부. null = 아직 확인 창 안(또는 송신 없음) */
  acked: boolean | null;
  /** 부호가 연달아 뒤집혀 자동 보정을 멈춘 상태(재정렬·다음 곡 시작 때 풀린다) */
  halted: boolean;
}

/** 각도를 (−180, 180]로 접는다 */
export function wrap180(deg: number): number {
  let r = ((deg % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return r;
}

/** 중앙값. 빈 배열은 NaN */
export function median(nums: readonly number[]): number {
  if (nums.length === 0) return NaN;
  const a = [...nums].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 중앙절대편차. med를 주면 그 값 기준 */
export function medianAbsDev(nums: readonly number[], med: number = median(nums)): number {
  return median(nums.map((n) => Math.abs(n - med)));
}

export interface PadAnchor {
  pad: PadId;
  /** 중심 자세 (도) */
  pitch: number;
  yaw: number;
  /** 판정 반경 (도). computeBoundaries가 채운다 */
  radius: number;
  /** 사용자가 슬라이더로 정한 판정 반경(도, UX-64 D9). 있으면 computeBoundaries가 자동값 대신 clamp해서 radius에 넣는다 */
  radiusOverride?: number;
  /** 중심을 잡을 때 쓴 샘플 수 */
  samples: number;
  /** 샘플 퍼짐 (도). 손떨림·센서 노이즈 지표 */
  spread: number;
  /** 다른 손 앵커에서 옮겨 만든 앵커(PLAY-004 ①). 직접 친 값이 아니라 samples 0, 간격 경고에서 뺀다 */
  derived?: true;
}

export interface CalibrationProfile {
  id: string;
  name: string;
  createdAt: string;
  /** 어떤 입력으로 잡았는지. 하드웨어 교체 시 재캘리브레이션 판단 근거 */
  source: SensorId;
  anchors: Partial<Record<PadId, PadAnchor>>;
  /** 판정 반경 상한 (도) */
  maxRadiusDeg: number;
  /** 오디오 출력 오프셋 (ms). 판정 시 타격 시각에서 뺀다 */
  audioOffsetMs: number;
}

/**
 * 손별 앵커 집합. 인덱스 = StickId(0 왼손, 1 오른손). null = 그 손은 보정 안 됨(PLAY-004 D1).
 * 손별 앵커 7개가 곧 스틱에 보내는 SET_PAD_TABLE 한 장이고 FE 판정 프로필도 같은 값이다
 */
export type HandAnchorSet = Partial<Record<PadId, PadAnchor>>;
export type HandAnchors = [HandAnchorSet | null, HandAnchorSet | null];

export function createEmptyProfile(source: CalibrationProfile['source']): CalibrationProfile {
  return {
    id: `cal-${Date.now().toString(36)}`,
    name: '새 캘리브레이션',
    createdAt: new Date().toISOString(),
    source,
    anchors: {},
    maxRadiusDeg: DEFAULT_SENSOR_TUNING.maxRadiusDeg,
    audioOffsetMs: 0,
  };
}

const DEG = Math.PI / 180;

/** 방향 단위 벡터 [x, y, z]. x = 정면, y = 오른쪽, z = 위 — 스틱 패킷의 elev·azim 정의와 같다 */
export type Vec3 = [number, number, number];

/** 고도(pitch)·방위(yaw) → 단위 벡터 (cos el·cos az, cos el·sin az, sin el) */
export function poseToVec(p: Pose): Vec3 {
  const el = p.pitch * DEG;
  const az = p.yaw * DEG;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

/** 단위 벡터 → 고도·방위(도). 영벡터는 (0, 0) */
export function vecToPose(v: Vec3): Pose {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) return { pitch: 0, yaw: 0 };
  return { pitch: Math.asin(Math.max(-1, Math.min(1, v[2] / len))) / DEG, yaw: Math.atan2(v[1], v[0]) / DEG };
}

/** 두 자세의 대원 각도(도). 방위각 ±180° 경계에서도 연속이다 */
export function angleBetween(a: Pose, b: Pose): number {
  const u = poseToVec(a);
  const w = poseToVec(b);
  const dot = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

/** 각도 공간 거리. 대원 각도로 계산한다(시그니처는 유지) */
export function poseDistance(a: Pose, b: Pose): number {
  return angleBetween(a, b);
}

/** 벡터 합을 정규화한 평균 자세. 빈 배열은 (0, 0) */
export function meanPose(poses: readonly Pose[]): Pose {
  if (poses.length === 0) return { pitch: 0, yaw: 0 };
  const sum: Vec3 = [0, 0, 0];
  for (const p of poses) {
    const v = poseToVec(p);
    sum[0] += v[0];
    sum[1] += v[1];
    sum[2] += v[2];
  }
  return vecToPose(sum);
}

/** 2타 퍼짐 = 두 타격의 대원 각도(도) */
export function pairSpread(a: Pose, b: Pose): number {
  return angleBetween(a, b);
}

/** 샘플 평균과 퍼짐(평균에서의 RMS 각도) */
export function summarizePoses(samples: Pose[]): { mean: Pose; spread: number } {
  if (samples.length === 0) return { mean: { pitch: 0, yaw: 0 }, spread: 0 };
  const mean = meanPose(samples);
  const spread = Math.sqrt(samples.reduce((s, p) => s + angleBetween(p, mean) ** 2, 0) / samples.length);
  return { mean, spread };
}

/**
 * 경계 계산: 반경 = clamp(하한, 상한, 가장 가까운 다른 앵커까지 각도 × radiusFactor).
 * 앵커가 하나뿐이면 상한을 쓴다. 상한이 하한보다 작으면 상한이 이긴다.
 */
export function computeBoundaries(
  anchors: Partial<Record<PadId, PadAnchor>>,
  maxRadiusDeg: number,
  radiusFactor: number = DEFAULT_SENSOR_TUNING.radiusFactor,
  minRadiusDeg: number = DEFAULT_SENSOR_TUNING.minRadiusDeg,
): Partial<Record<PadId, PadAnchor>> {
  const list = Object.values(anchors).filter((a): a is PadAnchor => !!a);
  const out: Partial<Record<PadId, PadAnchor>> = {};
  for (const a of list) {
    let nearest = Infinity;
    for (const b of list) {
      if (b.pad === a.pad) continue;
      nearest = Math.min(nearest, angleBetween(a, b));
    }
    const auto = Number.isFinite(nearest) ? Math.min(maxRadiusDeg, Math.max(minRadiusDeg, nearest * radiusFactor)) : maxRadiusDeg;
    const radius = a.radiusOverride !== undefined ? clampRadius(a.radiusOverride, minRadiusDeg, maxRadiusDeg) : auto;
    out[a.pad] = { ...a, radius };
  }
  return out;
}

/** 판정 반경을 하한·상한으로 자른다. 상한이 하한보다 작으면 상한이 이긴다(computeBoundaries와 같은 규칙) */
export interface PadGap {
  a: PadId;
  b: PadId;
  /** 두 앵커 사이 각도(도) */
  deg: number;
}

/** 한 손 앵커 집합에서 thresholdDeg 미만으로 가까운 패드 쌍(쌍마다 1번, 가까운 순). 결과 화면의 겹침 표시용 */
export function padGaps(set: HandAnchorSet, thresholdDeg: number): PadGap[] {
  const entries = Object.entries(set) as [PadId, PadAnchor | undefined][];
  const out: PadGap[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [pa, a] = entries[i];
      const [pb, b] = entries[j];
      if (!a || !b) continue;
      const deg = angleBetween(a, b);
      if (deg < thresholdDeg) out.push({ a: pa, b: pb, deg });
    }
  }
  return out.sort((x, y) => x.deg - y.deg);
}

export function clampRadius(deg: number, minRadiusDeg: number, maxRadiusDeg: number): number {
  return Math.min(maxRadiusDeg, Math.max(minRadiusDeg, deg));
}

/**
 * 한 손 앵커 집합에서 한 패드의 판정 반경을 사용자 값으로 덮어쓴다(UX-64 D9). 그 패드 앵커가 없으면 그대로.
 * radius도 함께 바꿔 computeBoundaries를 다시 돌리지 않아도 프로필·표에 반영된다
 */
export function withRadiusOverride(
  set: HandAnchorSet | null,
  pad: PadId,
  deg: number,
  minRadiusDeg: number,
  maxRadiusDeg: number,
): HandAnchorSet | null {
  const a = set?.[pad];
  if (!set || !a) return set;
  const radius = clampRadius(deg, minRadiusDeg, maxRadiusDeg);
  return { ...set, [pad]: { ...a, radiusOverride: radius, radius } };
}

export interface PadResolution {
  pad: PadId;
  distanceDeg: number;
  /** 반경 안에 들어왔는지. false면 "가장 가깝긴 하나 영역 밖" */
  inside: boolean;
}

/**
 * 기준선 판정. candidates를 주면 채보 후보로 제한한다(2-4 "채보 검증" 구조).
 * 반환 null = 앵커가 없음.
 */
export function resolvePad(
  profile: CalibrationProfile | null,
  pose: Pose,
  candidates?: PadId[],
): PadResolution | null {
  if (!profile) return null;
  let best: PadResolution | null = null;
  for (const a of Object.values(profile.anchors)) {
    if (!a) continue;
    if (candidates && !candidates.includes(a.pad)) continue;
    const d = angleBetween(pose, a);
    if (!best || d < best.distanceDeg) {
      // acos 반올림 오차(1e-14)로 경계값이 밖으로 새지 않게 작은 여유를 둔다
      best = { pad: a.pad, distanceDeg: d, inside: d <= a.radius + 1e-9 };
    }
  }
  return best;
}
