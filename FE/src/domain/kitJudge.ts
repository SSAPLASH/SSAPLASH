// 배치(kitLayout) → 판정용 프로필 유도(설계 SETUP-unified-setup D1·D2).
// 화면에서 드래그한 패드 위치·크기를 각도 공간의 앵커로 바꿔, 기존 판정(resolvePad)을 그대로 쓴다.
import type { KitLayout } from './kitLayout';
import type { PadId } from './pads';
import { STICK_PADS } from './pads';
import { computeBoundaries, type CalibrationProfile, type PadAnchor } from './calibration';
import { screenRadiusToDeg, screenToPose, type AngleRange } from './kitMapping';

export interface LayoutProfileOptions {
  /** 판정 반경 상한 (도) */
  maxRadiusDeg: number;
  /** 이웃 패드 거리 대비 반경 비율 (겹침 방지 상한) */
  radiusFactor: number;
  /** 프로필에 넣을 패드. 기본은 스틱 패드(킥 제외) */
  pads?: PadId[];
  /** 생성 시각. 생략하면 호출 시각 */
  createdAt?: string;
}

/**
 * 배치를 판정 프로필로 바꾼다. 중심은 screenToPose, 반경은 패드 r의 각도값과
 * computeBoundaries(이웃 거리 × radiusFactor, 상한)가 주는 값 중 작은 쪽이다.
 */
export function layoutToProfile(layout: KitLayout, angleRange: AngleRange, opts: LayoutProfileOptions): CalibrationProfile {
  const pads = opts.pads ?? STICK_PADS;
  const centers: Partial<Record<PadId, PadAnchor>> = {};
  for (const pad of pads) {
    const pl = layout[pad];
    const pose = screenToPose(pl.x, pl.y, angleRange);
    centers[pad] = { pad, pitch: pose.pitch, yaw: pose.yaw, radius: screenRadiusToDeg(pl.r, angleRange), samples: 0, spread: 0 };
  }
  const limits = computeBoundaries(centers, opts.maxRadiusDeg, opts.radiusFactor);
  const anchors: Partial<Record<PadId, PadAnchor>> = {};
  for (const pad of pads) {
    const c = centers[pad]!;
    anchors[pad] = { ...c, radius: Math.min(c.radius, limits[pad]!.radius) };
  }
  return {
    id: 'layout',
    name: '배치 기반',
    createdAt: opts.createdAt ?? new Date().toISOString(),
    source: 'layout',
    anchors,
    maxRadiusDeg: opts.maxRadiusDeg,
    audioOffsetMs: 0,
  };
}
