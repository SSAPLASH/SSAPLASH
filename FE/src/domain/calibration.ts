// 캘리브레이션 프로필과 기준선 패드 판정(PLAY-03).
// 패드마다 "중심 자세(앵커)"를 잡고, 경계는 앵커 간 거리로 자동 계산한다.
// 하드웨어가 오면 자세의 출처만 IMU로 바뀌고 이 파일은 그대로 쓴다.
import type { PadId } from './pads';
import type { Pose, SensorId } from './events';
import { DEFAULT_SENSOR_TUNING } from './tuning';

/** 스틱에 보낸 패드 표의 적용 상태. 입력 계층(padTableSync)이 만들고 store가 보관한다 */
export interface PadTableStatus {
  sent: number;
  /** PARAM_ACK_PAD_TABLE의 value. 확인 창 안에 못 받았으면 null */
  acked: number | null;
  /** 전송 시각(performance.now) */
  at: number;
}

export interface PadAnchor {
  pad: PadId;
  /** 중심 자세 (도) */
  pitch: number;
  yaw: number;
  /** 판정 반경 (도). computeBoundaries가 채운다 */
  radius: number;
  /** 중심을 잡을 때 쓴 샘플 수 */
  samples: number;
  /** 샘플 퍼짐 (도). 손떨림·센서 노이즈 지표 */
  spread: number;
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

/** 캘리브레이션 캡처 방식: 홀딩(기획발표) / 2타(공통 명세서). D7 */
export type CaptureMode = 'hold' | 'hits';

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

/** 각도 공간 거리. yaw는 pitch보다 민감하지 않게 가중치를 둘 수 있으나 1차는 유클리드 */
export function poseDistance(a: Pose, b: Pose): number {
  const dp = a.pitch - b.pitch;
  const dy = a.yaw - b.yaw;
  return Math.hypot(dp, dy);
}

/** 샘플 평균과 퍼짐 */
export function summarizePoses(samples: Pose[]): { mean: Pose; spread: number } {
  if (samples.length === 0) return { mean: { pitch: 0, yaw: 0 }, spread: 0 };
  const mean = samples.reduce(
    (acc, p) => ({ pitch: acc.pitch + p.pitch / samples.length, yaw: acc.yaw + p.yaw / samples.length }),
    { pitch: 0, yaw: 0 },
  );
  const spread = Math.sqrt(samples.reduce((s, p) => s + poseDistance(p, mean) ** 2, 0) / samples.length);
  return { mean, spread };
}

/**
 * 경계 계산: 반경 = min(상한, 가장 가까운 다른 앵커까지 거리 × radiusFactor).
 * 앵커가 하나뿐이면 상한을 쓴다.
 */
export function computeBoundaries(
  anchors: Partial<Record<PadId, PadAnchor>>,
  maxRadiusDeg: number,
  radiusFactor: number = DEFAULT_SENSOR_TUNING.radiusFactor,
): Partial<Record<PadId, PadAnchor>> {
  const list = Object.values(anchors).filter((a): a is PadAnchor => !!a);
  const out: Partial<Record<PadId, PadAnchor>> = {};
  for (const a of list) {
    let nearest = Infinity;
    for (const b of list) {
      if (b.pad === a.pad) continue;
      nearest = Math.min(nearest, poseDistance(a, b));
    }
    const radius = Number.isFinite(nearest) ? Math.min(maxRadiusDeg, nearest * radiusFactor) : maxRadiusDeg;
    out[a.pad] = { ...a, radius };
  }
  return out;
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
    const d = poseDistance(pose, a);
    if (!best || d < best.distanceDeg) {
      best = { pad: a.pad, distanceDeg: d, inside: d <= a.radius };
    }
  }
  return best;
}
