// 랜딩 스틱 무대의 3차원 공간 계산: 벡터 연산, 카메라, 투영, 무대 크기 맞춤. React·DOM·canvas 접근 없음.

// 좌표는 cm. x 오른쪽, y 위, z 카메라에서 멀어지는 쪽.
export type Vec3 = [number, number, number];

export interface StageCamera {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  // 무대 크기에 맞춘 배율과 화면 오프셋(CSS px)
  scale: number;
  offsetX: number;
  offsetY: number;
  // 카메라 좌표로 바꾼 주광·보조광 방향
  keyLight: Vec3;
  fillLight: Vec3;
}

export const TAU = Math.PI * 2;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mix3 = (a: Vec3, b: Vec3, k: number): Vec3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
// 음수에도 0 이상 n 미만을 돌려주는 나머지
export const mod = (a: number, n: number): number => ((a % n) + n) % n;
export const rad = (deg: number): number => (deg * Math.PI) / 180;

// 세계 좌표 조명 방향(정규화)
export const KEY_LIGHT_WORLD: Vec3 = norm([-0.45, 0.8, -0.42]);
export const FILL_LIGHT_WORLD: Vec3 = norm([0.75, 0.25, -0.45]);

// 세계 방향을 카메라 좌표로 바꾼다.
export function dirToCamera(cam: StageCamera, d: Vec3): Vec3 {
  return [dot(d, cam.right), dot(d, cam.up), dot(d, cam.forward)];
}

// 세계 점을 카메라 좌표로 바꾼다.
export function toCamera(cam: StageCamera, p: Vec3): Vec3 {
  return dirToCamera(cam, sub(p, cam.eye));
}

// 카메라 좌표 점을 화면 좌표로 투영한다.
export function projectCamera(cam: StageCamera, c: Vec3): [number, number] {
  return [cam.offsetX + (cam.scale * c[0]) / c[2], cam.offsetY - (cam.scale * c[1]) / c[2]];
}

// 눈 위치와 바라보는 점으로 카메라를 만든다. 배율·오프셋은 fitCamera가 채운다.
export function makeCamera(eye: Vec3, target: Vec3): StageCamera {
  const forward = norm(sub(target, eye));
  const right = norm(cross([0, 1, 0], forward));
  const up = cross(forward, right);
  const cam: StageCamera = {
    eye,
    forward,
    right,
    up,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    keyLight: [0, 0, 1],
    fillLight: [0, 0, 1],
  };
  cam.keyLight = dirToCamera(cam, KEY_LIGHT_WORLD);
  cam.fillLight = dirToCamera(cam, FILL_LIGHT_WORLD);
  return cam;
}

// 세계 점을 화면 x·y로 투영한다.
export function project(cam: StageCamera, p: Vec3): [number, number] {
  return projectCamera(cam, toCamera(cam, p));
}

// 무대 여백: 좌우 6%, 위 18%, 아래 5%. 위쪽은 블루투스 표시(높이 약 17%)가 들어 올린 스틱과 겹치지 않게 비운다
const MARGIN_X = 0.06;
const MARGIN_TOP = 0.18;
const MARGIN_BOTTOM = 0.05;

// 담을 점이 모두 여백 안에 들어오도록 배율·오프셋을 채운 새 카메라를 돌려준다.
export function fitCamera(
  cam: StageCamera,
  points: Vec3[],
  width: number,
  height: number,
): StageCamera {
  const unit: StageCamera = { ...cam, scale: 1, offsetX: 0, offsetY: 0 };
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    const q = project(unit, p);
    if (q[0] < x0) x0 = q[0];
    if (q[0] > x1) x1 = q[0];
    if (q[1] < y0) y0 = q[1];
    if (q[1] > y1) y1 = q[1];
  }
  const mx = width * MARGIN_X;
  const mt = height * MARGIN_TOP;
  const mb = height * MARGIN_BOTTOM;
  const spanX = Math.max(x1 - x0, 1e-9);
  const spanY = Math.max(y1 - y0, 1e-9);
  const scale = Math.min((width - 2 * mx) / spanX, (height - mt - mb) / spanY);
  return {
    ...unit,
    scale,
    offsetX: width / 2 - (scale * (x0 + x1)) / 2,
    offsetY: mt + (height - mt - mb) / 2 - (scale * (y0 + y1)) / 2,
  };
}
