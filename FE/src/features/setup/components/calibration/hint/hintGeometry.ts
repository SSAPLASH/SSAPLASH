// 실수 안내 그림의 좌표 계산(PLAY-004 v0.4, 순수 함수). 드럼 그림(DrumKit)과 같은 표에서 패드 링 자리를 얻어 안내를 그 위에 맞춘다.
import { RING } from '@/components/drum/padRing';
import type { StickId } from '@/domain/events';
import { kitBoxFor, kitPadsFor, type KitSkin } from '@/domain/kit/drumKit';
import { handPoseTo } from '@/domain/kit/kitModel';
import type { PadId } from '@/domain/kit/pads';

/** 킷 상자 단위(kitBoxFor)의 패드 링: 중심과 가로·세로 반지름 */
export interface PadRing {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** 고정 배치(원근 보기)에서 그 패드의 링. 그림에 없는 패드면 null */
export function padRing(skin: KitSkin, pad: PadId): PadRing | null {
  const p = kitPadsFor(skin, 'persp').find((x) => x.pad === pad);
  if (!p) return null;
  const ring = p.art?.ring ?? RING[p.shape];
  const k = p.w / 160;
  return { cx: p.left + ring.cx * k, cy: p.top + ring.cy * k, rx: ring.rx * k, ry: ring.ry * k };
}

/** 킷 상자 크기(DrumKit의 viewBox와 같다) */
export function hintBox(skin: KitSkin): { w: number; h: number } {
  return kitBoxFor(skin, 'persp');
}

/** from에서 to로 가는 단위 벡터(그림 좌표, y는 아래가 +). 두 중심이 거의 같으면 위쪽 */
export function awayVector(from: PadRing, to: PadRing): { ux: number; uy: number } {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const len = Math.hypot(dx, dy);
  return len < 1 ? { ux: 0, uy: -1 } : { ux: dx / len, uy: dy / len };
}

/** 링 중심에서 (ux, uy) 방향으로 가장자리까지의 거리 */
export function ringEdge(r: PadRing, ux: number, uy: number): number {
  return 1 / Math.hypot(ux / r.rx, uy / r.ry);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 방향 그림에 쓸 그 손의 패드 방향(도). yaw 오른쪽 +, pitch 위 +. 3D 모델(kitModel)의 가정값이고 그림이 깨지지 않게 범위를 자른다.
 * 스틱으로 치지 않는 패드(킥·하이햇 페달)는 null
 */
export function aimPose(stickId: StickId, pad: PadId): { yaw: number; pitch: number } | null {
  if (pad === 'KICK' || pad === 'HIHAT_PEDAL') return null;
  const pose = handPoseTo(stickId, pad);
  return { yaw: clamp(pose.yaw, -80, 80), pitch: clamp(pose.pitch, -60, 60) };
}
