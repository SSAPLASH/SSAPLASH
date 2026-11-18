// 드럼 배치 원근 보기의 좌표 계산(PLAY-004 원근 보기 설계). DOM·캔버스를 모른다.
// 저장 값(배치 x·y, 손별 앵커)은 그대로 두고, 그릴 때만 배치 좌표를 3D 점(몸 기준 미터: x 오른쪽·y 앞·z 위)으로 바꿔 투영한다.
// 스틱은 방향만 알고 거리를 모르므로 거리는 3D 모델(kitModel.PAD_POINTS)의 패드별 값을 가정값으로 쓴다.
import { poseToVec } from './calibration/calibration';
import type { Pose } from '../events';
import { radiusBasisOf, type FigBox, type KitLayout, type PadPlacement } from './kitLayout';
import { DEFAULT_ANGLE_RANGE, screenToPose, type AngleRange } from './kitMapping';
import { HIHAT_PEDAL_FIT } from './kitArt';
import { PAD_POINTS, type Point3 } from './kitModel';
import { LANE_PADS, type PadId } from './pads';

/** 내려다보는 각도(도) */
export const VIEW_PITCH_DEG = 50;
/** 시점이 바라보는 점(m) */
export const VIEW_TARGET: Point3 = [0.03, 0.5, -0.1];
/** 바라보는 점에서 시점까지 거리(m) */
export const VIEW_DIST = 2.15;
/**
 * 화각 배율. 화면 기준 길이(min(폭, 높이×1.6))에 곱한다.
 * 심벌을 배치 위쪽 끝(y 0.05)에 둬도 판 안쪽 여백(16px)까지 쓰면 위아래가 잘리지 않는 크기다.
 * 여백은 고정 px라 판이 클수록 빠듯하다: 가장 큰 판(그림 높이 약 700px)에서도 들어가게 잡았다
 */
export const VIEW_FOCAL = 0.765;
/** 그림 세로 가운데(높이 비율). 가운데보다 아래에 둬 높이 잡힌 심벌이 들어갈 자리를 위쪽에 남긴다 */
export const VIEW_CENTER_Y = 0.56;
/**
 * 가로 펴기의 가장자리 여백(기준 길이 대비). 배치 가로 끝(x 0.05·0.95)에 둔 패드의 중심이 그림 영역 끝에서 이만큼 안쪽에 온다.
 * 큰 심벌의 가로 반지름쯤이라 끝에 둔 패드가 판 밖으로 나가지 않는다
 */
export const VIEW_EDGE = 0.1;
/** 배치 좌표가 잘리는 범위의 반폭(0.05~0.95 → 0.45). 가로 끝이 그림 영역 끝에 닿게 펴는 기준이다 */
const LAYOUT_HALF = 0.45;
/** 바닥 높이(m) */
export const FLOOR_Z = -0.65;
/** 방향의 출발점: 두 손 출발점의 가운데 */
export const AIM_ORIGIN: Point3 = [0, 0, 0.1];
/** 하이햇 페달의 높이(m). 바닥 바로 위 */
const PEDAL_Z = -0.62;
/**
 * 하이햇 페달은 하이햇에 붙어 다닌다(같은 악기다: 페달을 밟으면 하이햇이 닫힌다). 자리와 크기는 실물 그림에서 페달 조각이
 * 하이햇 받침 그림에 맞물리는 비율(kitArt.HIHAT_PEDAL_FIT)을 그대로 쓴다. 그래야 받침과 페달이 이음매 없이 한 그림으로 보인다.
 * PEDAL_FLAT은 발판 타원의 세로/가로 비
 */
const PEDAL_FLAT = 0.87;
/**
 * 킥(세워진 베이스 드럼)의 자리(m). 킥은 발로 치는 패드라 배치 좌표와 무관하게 고정한다:
 * 화면 가로 가운데(시점이 바라보는 x), 탐보다 뒤쪽 바닥. 멀어서 탐 위로 윗부분이 보인다
 */
const KICK_X = 0;
const KICK_Y = 1.7;

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
  KICK: { kind: 'kick', radius: 0.26, height: 0 },
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

/** 자세(고도·방위) → 모델 축 단위 방향. 스틱 벡터(정면·오른쪽·위)를 모델 축(오른쪽·앞·위)으로 옮긴다 */
export function poseDir(pose: Pose): Point3 {
  const v = poseToVec(pose);
  return [v[1], v[0], v[2]];
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
  /** 원근 투영 그대로 */
  project(pt: Point3): Projected;
  /**
   * 그림 자리: 세로 자리·크기·깊이는 원근 투영 그대로, 가로 자리만 "기준점에서 본 방위각"에 비례하게 편다.
   * 스틱은 방향만 알기 때문에, 거리가 가까운 패드든 먼 패드든 같은 각도면 같은 가로 자리에 온다(가로 끝 각도 = 그림 영역 끝)
   */
  place(pt: Point3): Projected;
  /** 그림 가로 자리(px) → 배치 x(자르지 않음). place의 가로 역변환 */
  layoutXAt(sx: number): number;
}

/**
 * 그림 영역 크기로 시점을 만든다. 넓은 판에서 그림이 커지지 않게 기준 길이는 min(폭, 높이×1.6).
 * range는 가로 펴기에 쓰는 각도 범위다(배치 x 0~1 = ±yawDeg)
 */
export function makeCamera(box: FigBox, range: AngleRange = DEFAULT_ANGLE_RANGE): Camera {
  const basis = radiusBasisOf(box);
  const focal = basis * VIEW_FOCAL;
  const cx = box.w / 2;
  const cy = box.h * VIEW_CENTER_Y;
  /** 배치 x가 0.5에서 LAYOUT_HALF만큼 벗어났을 때의 가로 거리(px) */
  const spread = Math.max(1, box.w / 2 - basis * VIEW_EDGE);
  const project = (pt: Point3): Projected => {
    const r = sub(pt, CAM);
    const depth = Math.max(0.05, r[1] * COS - r[2] * SIN);
    const up = r[1] * SIN + r[2] * COS;
    const elev = Math.atan2(CAM[2] - pt[2], Math.max(0.2, Math.hypot(pt[0] - CAM[0], pt[1] - CAM[1])));
    return { sx: cx + (r[0] / depth) * focal, sy: cy - (up / depth) * focal, scale: focal / depth, depth, elev };
  };
  return {
    w: box.w,
    h: box.h,
    focal,
    project,
    place(pt) {
      const q = project(pt);
      // 기준점 바로 위·아래(가로 거리 0)는 방위각이 없다: 가운데로 둔다
      const dx = pt[0] - AIM_ORIGIN[0];
      const dy = pt[1] - AIM_ORIGIN[1];
      const yaw = dx === 0 && dy === 0 ? 0 : Math.atan2(dx, dy) / RAD;
      return { ...q, sx: cx + (yaw / (2 * range.yawDeg * LAYOUT_HALF)) * spread };
    },
    layoutXAt(sx) {
      return 0.5 + ((sx - cx) / spread) * LAYOUT_HALF;
    },
  };
}

/** 기준점(AIM_ORIGIN)에서 그 패드까지의 모델 거리(m) */
export function padReach(pad: StickPad): number {
  return len(sub(PAD_POINTS[pad], AIM_ORIGIN));
}

/**
 * 배치 좌표 → 3D 점. 스틱 패드는 방향 × 모델 거리, 킥은 고정 자리(배치 좌표를 쓰지 않는다).
 * 하이햇 페달은 하이햇 바로 아래 바닥이다: pl에는 하이햇의 배치 좌표를 넘긴다
 */
export function padPoint(pad: PadId, pl: Pick<PadPlacement, 'x' | 'y'>, range: AngleRange = DEFAULT_ANGLE_RANGE): Point3 {
  // 킥은 바닥에 세워 둔다: 중심 높이 = 바닥 + 반지름
  if (pad === 'KICK') return [KICK_X, KICK_Y, FLOOR_Z + PAD_SOLIDS.KICK.radius];
  const pose = screenToPose(pl.x, pl.y, range);
  if (!isStickPad(pad)) {
    const h = padPoint('HIHAT', pl, range);
    return [h[0], h[1], PEDAL_Z];
  }
  const d = poseDir(pose);
  const reach = padReach(pad);
  return [AIM_ORIGIN[0] + d[0] * reach, AIM_ORIGIN[1] + d[1] * reach, AIM_ORIGIN[2] + d[2] * reach];
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
  const q = cam.place(point);
  const rx = solid.radius * q.scale;
  // 킥은 연주자를 향해 서 있어 화면에서도 원에 가깝다
  const ry = solid.kind === 'kick' ? rx : rx * Math.sin(q.elev);
  const floor = cam.place([point[0], point[1], FLOOR_Z]);
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

/** 하이햇 페달의 화면 모양: 하이햇 모양에 붙여 만든다(받침 그림의 페달 자리, 하이햇보다 살짝 앞) */
function pedalShape(hihat: PadShape): PadShape {
  const rx = hihat.rx * HIHAT_PEDAL_FIT.size;
  return {
    pad: 'HIHAT_PEDAL',
    kind: 'pedal',
    cx: hihat.cx + hihat.rx * HIHAT_PEDAL_FIT.dx,
    cy: hihat.cy + hihat.rx * HIHAT_PEDAL_FIT.drop,
    rx,
    ry: rx * PEDAL_FLAT,
    wall: 0,
    stand: 0,
    shadow: null,
    depth: hihat.depth - 0.01,
    point: [hihat.point[0], hihat.point[1], PEDAL_Z],
  };
}

/** 배치 전체의 화면 모양. 먼 것부터(그리는 순서). 하이햇 페달은 배치 좌표와 무관하게 하이햇에 붙는다 */
export function kitShapes(layout: KitLayout, cam: Camera, range: AngleRange = DEFAULT_ANGLE_RANGE): PadShape[] {
  const list = LANE_PADS.filter((pad) => pad !== 'HIHAT_PEDAL').map((pad) => padShape(pad, padPoint(pad, layout[pad], range), cam));
  const hihat = list.find((s) => s.pad === 'HIHAT');
  if (hihat) list.push(pedalShape(hihat));
  return list.sort((a, b) => b.depth - a.depth);
}
