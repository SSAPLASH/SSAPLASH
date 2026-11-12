// 드럼 배치 원근 보기의 좌표 계산(PLAY-004 원근 보기 설계). DOM·캔버스를 모른다.
// 저장 값(배치 x·y, 손별 앵커)은 그대로 두고, 그릴 때만 배치 좌표를 3D 점(몸 기준 미터: x 오른쪽·y 앞·z 위)으로 바꿔 투영한다.
// 스틱은 방향만 알고 거리를 모르므로 거리는 3D 모델(kitModel.PAD_POINTS)의 패드별 값을 가정값으로 쓴다.
import { poseToVec, vecToPose } from '../calibration';
import type { Pose, StickId } from '../events';
import { radiusBasisOf, type FigBox, type KitLayout, type PadPlacement } from '../kitLayout';
import { DEFAULT_ANGLE_RANGE, poseToScreen, screenToPose, type AngleRange } from './kitMapping';
import { HAND_ORIGINS, PAD_POINTS, type Point3 } from './kitModel';
import { LANE_PADS, type PadId } from '../pads';

/** 내려다보는 각도(도) */
export const VIEW_PITCH_DEG = 50;
/** 시점이 바라보는 점(m) */
export const VIEW_TARGET: Point3 = [0.03, 0.5, -0.1];
/** 바라보는 점에서 시점까지 거리(m) */
export const VIEW_DIST = 2.15;
/** 화각 배율. 화면 기준 길이(min(폭, 높이×1.6))에 곱한다 */
export const VIEW_FOCAL = 0.82;
/** 그림 세로 가운데(높이 비율). 기본 배치가 위아래로 고르게 놓이는 값 */
export const VIEW_CENTER_Y = 0.53;
/** 바닥 높이(m) */
export const FLOOR_Z = -0.65;
/** 방향의 출발점: 두 손 출발점의 가운데 */
export const AIM_ORIGIN: Point3 = [0, 0, 0.1];
/** 하이햇 페달이 놓이는 앞쪽 거리·높이(m) */
const PEDAL_Y = 0.28;
const PEDAL_Z = -0.62;
/** 킥(세워진 베이스 드럼)의 앞쪽 거리. 스네어 뒤, 탐 아래 */
const KICK_Y = 0.62;
/** 페달 좌우 자리: x = sin(방위각) × 이 값 */
const PEDAL_REACH = 0.8;

/** kick은 바닥에 세워져 연주자를 향한 원판, pedal은 바닥의 납작한 발판 */
export type PadKind = 'drum' | 'cymbal' | 'kick' | 'pedal';

/** 패드 실물 크기(m). 배치의 r(평면 보기용)은 원근 보기에서 쓰지 않는다 */
export const PAD_SOLIDS: Record<PadId, { kind: PadKind; radius: number; height: number }> = {
  CRASH: { kind: 'cymbal', radius: 0.2, height: 0 },
  RIDE: { kind: 'cymbal', radius: 0.24, height: 0 },
  SMALL_TOM: { kind: 'drum', radius: 0.13, height: 0.16 },
  MID_TOM: { kind: 'drum', radius: 0.14, height: 0.17 },
  HIHAT: { kind: 'cymbal', radius: 0.17, height: 0 },
  SNARE: { kind: 'drum', radius: 0.18, height: 0.13 },
  FLOOR_TOM: { kind: 'drum', radius: 0.2, height: 0.38 },
  KICK: { kind: 'kick', radius: 0.18, height: 0 },
  HIHAT_PEDAL: { kind: 'pedal', radius: 0.1, height: 0 },
};

const RAD = Math.PI / 180;
const TH = VIEW_PITCH_DEG * RAD;
const COS = Math.cos(TH);
const SIN = Math.sin(TH);
/** 시점 위치 */
const CAM: Point3 = [VIEW_TARGET[0], VIEW_TARGET[1] - VIEW_DIST * COS, VIEW_TARGET[2] + VIEW_DIST * SIN];

type StickPad = keyof typeof PAD_POINTS;
function isStickPad(pad: PadId): pad is StickPad {
  return pad in PAD_POINTS;
}

const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Point3) => Math.hypot(a[0], a[1], a[2]);
const clampPos = (v: number) => Math.min(0.95, Math.max(0.05, v));

/** 자세(고도·방위) → 모델 축 단위 방향. 스틱 벡터(정면·오른쪽·위)를 모델 축(오른쪽·앞·위)으로 옮긴다 */
export function poseDir(pose: Pose): Point3 {
  const v = poseToVec(pose);
  return [v[1], v[0], v[2]];
}

/** 모델 축 방향 → 자세 */
export function dirPose(d: Point3): Pose {
  return vecToPose([d[1], d[0], d[2]]);
}

export interface Projected {
  /** 화면 px */
  sx: number;
  sy: number;
  /** 그 깊이에서 1m가 몇 px인가 */
  scale: number;
  /** 시점에서의 깊이(m). 클수록 멀다 */
  depth: number;
  /** 그 점을 보는 시선이 수평면과 이루는 각(rad). 수평 원판의 세로 반지름 = 가로 반지름 × sin */
  elev: number;
}

export interface Camera {
  w: number;
  h: number;
  /** 초점 거리(px) */
  focal: number;
  project(pt: Point3): Projected;
  /** 화면 점을 지나는 시선: 시점 위치와 방향(앞 성분 1, 단위 벡터가 아니다) */
  ray(sx: number, sy: number): { origin: Point3; dir: Point3 };
  /** 화면 점을 지나는 시선이 "깊이가 depth인, 화면과 나란한 면"과 만나는 3D 점 */
  unproject(sx: number, sy: number, depth: number): Point3;
}

/** 그림 영역 크기로 시점을 만든다. 넓은 판에서 그림이 커지지 않게 기준 길이는 min(폭, 높이×1.6) */
export function makeCamera(box: FigBox): Camera {
  const focal = radiusBasisOf(box) * VIEW_FOCAL;
  const cx = box.w / 2;
  const cy = box.h * VIEW_CENTER_Y;
  /** 화면 점 → 시선 방향(앞 성분 1) */
  const ray = (sx: number, sy: number): Point3 => {
    const a = (sx - cx) / focal;
    const b = -(sy - cy) / focal;
    return [a, COS + b * SIN, -SIN + b * COS];
  };
  return {
    w: box.w,
    h: box.h,
    focal,
    ray: (sx, sy) => ({ origin: CAM, dir: ray(sx, sy) }),
    project(pt) {
      const r = sub(pt, CAM);
      const depth = Math.max(0.05, r[1] * COS - r[2] * SIN);
      const up = r[1] * SIN + r[2] * COS;
      const elev = Math.atan2(CAM[2] - pt[2], Math.max(0.2, Math.hypot(pt[0] - CAM[0], pt[1] - CAM[1])));
      return { sx: cx + (r[0] / depth) * focal, sy: cy - (up / depth) * focal, scale: focal / depth, depth, elev };
    },
    unproject(sx, sy, depth) {
      const d = ray(sx, sy);
      return [CAM[0] + d[0] * depth, CAM[1] + d[1] * depth, CAM[2] + d[2] * depth];
    },
  };
}

/** 기준점(AIM_ORIGIN)에서 그 패드까지의 모델 거리(m) */
export function padReach(pad: StickPad): number {
  return len(sub(PAD_POINTS[pad], AIM_ORIGIN));
}

/** 배치 좌표 → 3D 점. 스틱 패드는 방향 × 모델 거리, 킥·하이햇 페달은 바닥의 고정 줄에서 좌우만 */
export function padPoint(pad: PadId, pl: Pick<PadPlacement, 'x' | 'y'>, range: AngleRange = DEFAULT_ANGLE_RANGE): Point3 {
  const pose = screenToPose(pl.x, pl.y, range);
  if (!isStickPad(pad)) {
    const x = Math.sin(pose.yaw * RAD) * PEDAL_REACH;
    // 킥은 바닥에 세워 둔다: 중심 높이 = 바닥 + 반지름
    return pad === 'KICK' ? [x, KICK_Y, FLOOR_Z + PAD_SOLIDS.KICK.radius] : [x, PEDAL_Y, PEDAL_Z];
  }
  const d = poseDir(pose);
  const reach = padReach(pad);
  return [AIM_ORIGIN[0] + d[0] * reach, AIM_ORIGIN[1] + d[1] * reach, AIM_ORIGIN[2] + d[2] * reach];
}

/** 3D 점 → 배치 좌표(자르지 않음). 스틱 패드용: 기준점에서 그 점을 보는 방향 */
function pointToLayout(pt: Point3, range: AngleRange): { x: number; y: number } {
  return poseToScreen(dirPose(sub(pt, AIM_ORIGIN)), range);
}

export interface PadShape {
  pad: PadId;
  kind: PadKind;
  /** 윗면 중심(px) */
  cx: number;
  cy: number;
  /** 윗면 타원 반지름(px) */
  rx: number;
  ry: number;
  /** 통 옆면 높이(px). 드럼만 */
  wall: number;
  /** 윗면에서 바닥까지 스탠드 길이(px). 심벌만 */
  stand: number;
  /** 바닥 그림자 타원. 페달은 없다 */
  shadow: { cx: number; cy: number; rx: number; ry: number } | null;
  depth: number;
  /** 3D 점(m) */
  point: Point3;
}

/** 패드 하나의 화면 모양. 그리기와 클릭 판정이 같이 쓴다 */
export function padShape(pad: PadId, point: Point3, cam: Camera): PadShape {
  const solid = PAD_SOLIDS[pad];
  const q = cam.project(point);
  const rx = solid.radius * q.scale;
  // 킥은 연주자를 향해 서 있어 화면에서도 원에 가깝다
  const ry = solid.kind === 'kick' ? rx : rx * Math.sin(q.elev);
  const floor = cam.project([point[0], point[1], FLOOR_Z]);
  const frx = solid.radius * floor.scale * 0.9;
  return {
    pad,
    kind: solid.kind,
    cx: q.sx,
    cy: q.sy,
    rx,
    ry,
    wall: solid.kind === 'drum' ? solid.height * q.scale * Math.cos(q.elev) : 0,
    stand: solid.kind === 'cymbal' ? Math.max(0, floor.sy - q.sy) : 0,
    shadow: solid.kind === 'pedal' || solid.kind === 'kick' ? null : { cx: floor.sx, cy: floor.sy, rx: frx, ry: frx * Math.sin(floor.elev) },
    depth: q.depth,
    point,
  };
}

/** 배치 전체의 화면 모양. 먼 것부터(그리는 순서) */
export function kitShapes(layout: KitLayout, cam: Camera, range: AngleRange = DEFAULT_ANGLE_RANGE): PadShape[] {
  return LANE_PADS.map((pad) => padShape(pad, padPoint(pad, layout[pad], range), cam)).sort((a, b) => b.depth - a.depth);
}

/** 점이 그 패드의 윗면 타원이나 통 옆면 안인가 */
function inShape(s: PadShape, px: number, py: number): boolean {
  const nx = (px - s.cx) / s.rx;
  if (Math.abs(nx) > 1) return false;
  const ny = (py - s.cy) / s.ry;
  if (nx * nx + ny * ny <= 1) return true;
  if (s.wall <= 0) return false;
  // 옆면: 윗면 중심선 아래로 통 높이만큼, 아래 끝은 타원의 앞쪽 호
  const edge = s.ry * Math.sqrt(1 - nx * nx);
  return py >= s.cy && py <= s.cy + s.wall + edge;
}

/** 클릭 판정: 가까운(앞에 보이는) 패드부터. shapes는 kitShapes 순서(먼 것부터) */
export function hitTestPads(shapes: readonly PadShape[], px: number, py: number): PadId | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (inShape(shapes[i], px, py)) return shapes[i].pad;
  }
  return null;
}

/**
 * 끌기: 패드의 새 화면 중심(px) → 배치 좌표(0.05~0.95).
 * 스틱 패드는 기준점을 중심으로 한 공(반지름 = 모델 거리) 위에서만 움직인다. 시선이 공과 만나는 두 점 중 지금 자리에 가까운 점을 고르고,
 * 시선이 공을 벗어나면 공에서 시선에 가장 가까운 점을 쓴다. 그 점을 기준점에서 본 방향이 새 배치 좌표다.
 * 페달은 바닥 줄 위에서 좌우만 움직이고 y는 그대로다
 */
export function dragToLayout(pad: PadId, sx: number, sy: number, current: Pick<PadPlacement, 'x' | 'y'>, cam: Camera, range: AngleRange = DEFAULT_ANGLE_RANGE): { x: number; y: number } {
  const here = padPoint(pad, current, range);
  if (!isStickPad(pad)) {
    // 페달 줄(앞쪽 거리·높이 고정)은 깊이가 일정하다. 그 깊이에서 포인터의 가로 자리만 쓴다
    const x = cam.unproject(sx, sy, cam.project(here).depth)[0];
    const yaw = Math.asin(Math.min(1, Math.max(-1, x / PEDAL_REACH))) / RAD;
    return { x: clampPos(poseToScreen({ yaw, pitch: 0 }, range).x), y: current.y };
  }
  const { origin, dir } = cam.ray(sx, sy);
  const n = len(dir);
  const u: Point3 = [dir[0] / n, dir[1] / n, dir[2] / n];
  const oc = sub(origin, AIM_ORIGIN);
  const b = oc[0] * u[0] + oc[1] * u[1] + oc[2] * u[2];
  const reach = padReach(pad);
  const disc = b * b - (oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - reach * reach);
  const at = (t: number): Point3 => [origin[0] + u[0] * t, origin[1] + u[1] * t, origin[2] + u[2] * t];
  let next: Point3;
  if (disc >= 0) {
    const root = Math.sqrt(disc);
    const p1 = at(-b - root);
    const p2 = at(-b + root);
    next = len(sub(p1, here)) <= len(sub(p2, here)) ? p1 : p2;
  } else {
    // 시선이 공을 벗어났다: 시선에서 기준점에 가장 가까운 점의 방향(공의 가장자리)
    next = at(-b);
  }
  const s = pointToLayout(next, range);
  return { x: clampPos(s.x), y: clampPos(s.y) };
}

/** 손 출발점(center면 두 손 가운데)에서 pt를 보는 방향과 거리 */
function aimFrom(origin: Point3, pt: Point3): { dir: Point3; dist: number } {
  const v = sub(pt, origin);
  const dist = len(v) || 1;
  return { dir: [v[0] / dist, v[1] / dist, v[2] / dist], dist };
}

/** 자세 마커의 출발점. hand가 'center'면 두 손 가운데(포인터 모의 IMU: 마우스 자세는 손 구분이 없다) */
function poseOrigin(hand: StickId | 'center'): Point3 {
  return hand === 'center' ? AIM_ORIGIN : HAND_ORIGINS[hand];
}

/**
 * 스틱이 가리키는 끝점. 출발점에서 자세 방향으로 가되, 거리는 방향이 가까운 패드들의 거리를 가까운 정도로 섞는다
 * (패드를 정확히 가리키면 그 패드 위에 닿고, 사이에서는 부드럽게 이어진다)
 */
export function poseTip(hand: StickId | 'center', pose: Pose, shapes: readonly PadShape[]): Point3 {
  const origin = poseOrigin(hand);
  const d = poseDir(pose);
  let wsum = 0;
  let dsum = 0;
  for (const s of shapes) {
    if (s.kind === 'pedal' || s.kind === 'kick') continue;
    const a = aimFrom(origin, s.point);
    const dot = Math.min(1, Math.max(-1, a.dir[0] * d[0] + a.dir[1] * d[1] + a.dir[2] * d[2]));
    const ang = Math.acos(dot);
    const w = 1 / (ang * ang + 1e-4);
    wsum += w;
    dsum += w * a.dist;
  }
  const dist = wsum > 0 ? dsum / wsum : 0.6;
  return [origin[0] + d[0] * dist, origin[1] + d[1] * dist, origin[2] + d[2] * dist];
}

/**
 * 화면 점(px) → 자세. 포인터 모의 IMU용: 포인터 아래(없으면 화면에서 가장 가까운) 스틱 패드의 깊이 면에서 3D 점을 찾고,
 * 기준점에서 그 점을 보는 방향을 자세로 한다. 패드 중심 위에서는 그 패드의 배치 자세와 같다
 */
export function screenPointToPose(px: number, py: number, shapes: readonly PadShape[], cam: Camera): Pose {
  const sticks = shapes.filter((s) => s.kind !== 'pedal' && s.kind !== 'kick');
  if (sticks.length === 0) return { pitch: 0, yaw: 0 };
  const hit = hitTestPads(sticks, px, py);
  let base = sticks.find((s) => s.pad === hit);
  if (!base) {
    let best = Infinity;
    for (const s of sticks) {
      const dd = Math.hypot(px - s.cx, py - s.cy);
      if (dd < best) {
        best = dd;
        base = s;
      }
    }
  }
  return dirPose(sub(cam.unproject(px, py, base!.depth), AIM_ORIGIN));
}

/**
 * 정보 카드 자리 고르기(kitLayout.pickOverlayCorner)에 넘길 패드별 원. 화면 타원을 가로 반지름의 원으로 본다(넉넉한 쪽).
 * x·y는 그림 영역 정규 좌표, r은 radiusBasisOf(box) 기준 비율이다
 */
export function padScreenCircles(layout: KitLayout, box: FigBox, range: AngleRange = DEFAULT_ANGLE_RANGE): Record<PadId, PadPlacement> {
  const basis = radiusBasisOf(box);
  const out = {} as Record<PadId, PadPlacement>;
  for (const s of kitShapes(layout, makeCamera(box), range)) {
    out[s.pad] = { x: s.cx / box.w, y: (s.cy + s.wall / 2) / box.h, r: s.rx / basis };
  }
  return out;
}

/** 패드의 표시 좌표(cm, 몸 기준: x 오른쪽·y 앞·z 위). 그림에 놓인 3D 점 그대로다 */
export function padPointCm(pad: PadId, pl: Pick<PadPlacement, 'x' | 'y'>, range: AngleRange = DEFAULT_ANGLE_RANGE): { x: number; y: number; z: number } {
  const p = padPoint(pad, pl, range);
  return { x: p[0] * 100, y: p[1] * 100, z: p[2] * 100 };
}
