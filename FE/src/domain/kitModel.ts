// 3D 드럼셋 모델(PLAY-004 D4). 패드 위치와 손 출발점을 몸 기준 미터 좌표로 두고,
// 손마다 (패드 − 손 출발점) 방향을 고도·방위각으로 바꿔 손별 기본 앵커를 만든다.
// 보정 전 기본 판정 표에 쓴다. 화면 기본 배치(DEFAULT_KIT_LAYOUT)는 고정값이라 여기서 유도하지 않는다(후속 T8).
// 수치는 가정값이다(설계 U4) — 11/6 양손 보정 실측 평균으로 상수만 바꾼다.
import type { KitLayout } from './kitLayout';
import type { PadId } from './pads';
import { STICK_PADS } from './pads';
import type { StickId } from './events';
import { computeBoundaries, meanPose, type HandAnchors, type HandAnchorSet, type PadAnchor } from './calibration';
import { DEFAULT_ANGLE_RANGE, poseToScreen, type AngleRange } from './kitMapping';
import type { Pose } from './events';
import { DEFAULT_SENSOR_TUNING, type SensorTuning } from './tuning';

/** 몸 기준 좌표(미터): x 오른쪽(+), y 앞(+), z 위(+). 원점은 앉은 사람의 가슴 */
export type Point3 = readonly [number, number, number];

/** 손 출발점(스틱을 쥔 손의 위치). 인덱스 = StickId */
export const HAND_ORIGINS: readonly [Point3, Point3] = [
  [-0.2, 0.0, 0.1],
  [0.2, 0.0, 0.1],
];

/** 스틱 패드의 타격점 */
export const PAD_POINTS: Record<Exclude<PadId, 'KICK' | 'HIHAT_PEDAL'>, Point3> = {
  SNARE: [0.0, 0.45, -0.1],
  HIHAT: [-0.35, 0.45, 0.05],
  SMALL_TOM: [-0.12, 0.65, 0.1],
  MID_TOM: [0.12, 0.65, 0.1],
  FLOOR_TOM: [0.4, 0.5, -0.1],
  CRASH: [-0.3, 0.75, 0.45],
  RIDE: [0.4, 0.75, 0.4],
};

/** 손 출발점에서 패드를 보는 방향 → 고도(위 +)·방위(정면 0, 오른쪽 +) */
export function handPoseTo(stickId: StickId, pad: Exclude<PadId, 'KICK' | 'HIHAT_PEDAL'>): Pose {
  const o = HAND_ORIGINS[stickId];
  const p = PAD_POINTS[pad];
  const dx = p[0] - o[0];
  const dy = p[1] - o[1];
  const dz = p[2] - o[2];
  const DEG = 180 / Math.PI;
  return { yaw: Math.atan2(dx, dy) * DEG, pitch: Math.atan2(dz, Math.hypot(dx, dy)) * DEG };
}

function isStickPad(pad: PadId): pad is Exclude<PadId, 'KICK' | 'HIHAT_PEDAL'> {
  return pad !== 'KICK' && pad !== 'HIHAT_PEDAL';
}

/** 한 손의 기본 앵커(반경은 computeBoundaries). samples 0·spread 0으로 "모델값"임을 남긴다 */
export function defaultHandAnchorSet(stickId: StickId, tuning: SensorTuning = DEFAULT_SENSOR_TUNING): HandAnchorSet {
  const centers: HandAnchorSet = {};
  for (const pad of STICK_PADS) {
    if (!isStickPad(pad)) continue;
    const pose = handPoseTo(stickId, pad);
    const a: PadAnchor = { pad, pitch: pose.pitch, yaw: pose.yaw, radius: 0, samples: 0, spread: 0 };
    centers[pad] = a;
  }
  return computeBoundaries(centers, tuning.maxRadiusDeg, tuning.radiusFactor, tuning.minRadiusDeg);
}

/** 양손 기본 앵커 */
export function defaultHandAnchors(tuning: SensorTuning = DEFAULT_SENSOR_TUNING): HandAnchors {
  return [defaultHandAnchorSet(0, tuning), defaultHandAnchorSet(1, tuning)];
}

const clamp01 = (v: number) => Math.min(0.95, Math.max(0.05, v));

/**
 * 손별 앵커에서 표시 배치를 유도한다. 패드마다 앵커가 있는 손들의 방향 벡터 평균 → poseToScreen.
 * 없는 패드는 base 값을 쓰고, 반지름은 표시 전용이라 base 값을 유지한다. 위치는 0.05~0.95로 자른다
 */
export function anchorsToLayout(hands: HandAnchors, base: KitLayout, angleRange: AngleRange = DEFAULT_ANGLE_RANGE): KitLayout {
  const out = { ...base };
  for (const pad of STICK_PADS) {
    const poses: Pose[] = [];
    for (const hand of hands) {
      const a = hand?.[pad];
      if (a) poses.push({ pitch: a.pitch, yaw: a.yaw });
    }
    if (poses.length === 0) continue;
    const s = poseToScreen(meanPose(poses), angleRange);
    out[pad] = { ...base[pad], x: clamp01(s.x), y: clamp01(s.y) };
  }
  return out;
}
