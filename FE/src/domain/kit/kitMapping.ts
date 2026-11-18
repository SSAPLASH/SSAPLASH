// 각도 공간(pitch·yaw) ↔ 화면 공간(0~1) 변환. SETUP-01 "배치 변경이 판정 영역에 반영" 의 기준 규칙.
// 포인터 모의 IMU도 같은 규칙으로 자세를 만들기 때문에, 화면에서 패드 위에 포인터를 두면 그 패드의 자세가 된다.
import type { Pose } from '../events';

export interface AngleRange {
  /** 화면 가로 전체 = ±yawDeg */
  yawDeg: number;
  /** 화면 세로 전체 = ±pitchDeg (위가 +) */
  pitchDeg: number;
}

export const DEFAULT_ANGLE_RANGE: AngleRange = { yawDeg: 60, pitchDeg: 35 };

export function poseToScreen(p: Pose, r: AngleRange = DEFAULT_ANGLE_RANGE): { x: number; y: number } {
  return { x: 0.5 + p.yaw / (2 * r.yawDeg), y: 0.5 - p.pitch / (2 * r.pitchDeg) };
}

export function screenToPose(x: number, y: number, r: AngleRange = DEFAULT_ANGLE_RANGE): Pose {
  return { yaw: (x - 0.5) * 2 * r.yawDeg, pitch: -(y - 0.5) * 2 * r.pitchDeg };
}

/** 각도 반경(도)을 화면 가로 비율로 (대략치, 표시용) */
export function radiusToScreen(deg: number, r: AngleRange = DEFAULT_ANGLE_RANGE): number {
  return deg / (2 * r.yawDeg);
}

/** 화면 가로 비율 반경을 각도 반경(도)으로. radiusToScreen의 역함수 */
export function screenRadiusToDeg(radius: number, r: AngleRange = DEFAULT_ANGLE_RANGE): number {
  return radius * 2 * r.yawDeg;
}
