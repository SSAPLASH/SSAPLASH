// 랜딩 센서 스틱 무대의 캔버스 그리기. React·타이머·rAF 없이 프레임에 필요한 값을 받아 그리기만 한다.

import {
  COLLAR_FINISH,
  CONTACT_PHI,
  FULCRUM_S,
  FULCRUM_Y,
  GLOSS_FINISH,
  GRAPHITE,
  HANDLE_R,
  LED_START,
  L_TOTAL,
  MATERIAL_SEGMENTS,
  NECK,
  SAMPLE_COUNT,
  SAMPLE_RADII,
  SAMPLE_STEP,
  TIP_C,
  TIP_HL,
  TIP_R,
  WHITE,
  radiusAt,
  rimColor,
  shadeBand,
} from '@/features/landing/domain/stickModel';
import type { StageHit, StageLayout, StageStep, StickPose } from '@/features/landing/domain/stickLayout';
import {
  KEY_LIGHT_WORLD,
  TAU,
  add,
  clamp01,
  cross,
  dirToCamera,
  dot,
  mix3,
  mul,
  norm,
  project,
  projectCamera,
  toCamera,
  type StageCamera,
  type Vec3,
} from '@/features/landing/domain/stickSpace';
import { LIFT, MAX_THETA, poseAt, pointOnAxis } from '@/features/landing/domain/stickStroke';

// 단계별 그림 층 투명도(0~1). stickLayers와 같은 모양
export interface StageLayers {
  pad: number;
  imu: number;
  ble: number;
}

export interface StageFrame {
  // 카메라가 fitCamera를 거친 배치
  layout: StageLayout;
  // CSS px 크기와 장치 픽셀 비율
  width: number;
  height: number;
  dpr: number;
  // 장면 시각(초)과 단계
  t: number;
  step: StageStep;
  poses: StickPose[];
  // 지금 살아 있는 타격(시각 순, 시각이 지금 이전인 것만)
  hits: StageHit[];
  layers: StageLayers;
  brand: Vec3;
  // 캔버스 글자에 쓸 font-family 값
  font: string;
}

export const DEFAULT_BRAND: Vec3 = [0.208, 0.639, 0.831];
// 글자 크기 하한(px)
const MIN_FONT_PX = 9;
// 바닥 빛의 반지름(cm)
const FLOOR_LIGHT_R = 34;
// 블루투스 신호가 날아가는 시간(초)
const BLE_TRAVEL = 0.18;

const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

const css = (c: Vec3, a = 1): string =>
  `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(clamp01(c[2]) * 255)},${Math.max(0, a).toFixed(3)})`;

// `#rgb`·`#rrggbb`·`rgb()`·`rgba()` 문자열을 0~1 색으로 바꾼다. 읽을 수 없으면 fallback.
export function parseCssColor(value: string, fallback: Vec3 = DEFAULT_BRAND): Vec3 {
  const s = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Vec3;
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(s);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return fallback;
}

// 블루투스 표시에 뜰 이름: 나이가 0.18초 이상인 가장 최근 타격의 이름, 없으면 SNARE
export function bleChipName(hits: StageHit[], t: number): { name: string; flashAt: number } {
  for (let i = hits.length - 1; i >= 0; i--) {
    if (t - hits[i].time >= BLE_TRAVEL) return { name: hits[i].name, flashAt: hits[i].time + BLE_TRAVEL };
  }
  return { name: 'SNARE', flashAt: Number.NEGATIVE_INFINITY };
}

// ───────── 그리기 도구 ─────────

function planeTransform(ctx: CanvasRenderingContext2D, cam: StageCamera, c: Vec3, dpr: number): void {
  const p0 = project(cam, c);
  const px = project(cam, [c[0] + 1, c[1], c[2]]);
  const pz = project(cam, [c[0], c[1], c[2] + 1]);
  ctx.setTransform(dpr * (px[0] - p0[0]), dpr * (px[1] - p0[1]), dpr * (pz[0] - p0[0]), dpr * (pz[1] - p0[1]), dpr * p0[0], dpr * p0[1]);
}

function circlePath(ctx: CanvasRenderingContext2D, cam: StageCamera, c: Vec3, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    const q = project(cam, [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]);
    if (i === 0) ctx.moveTo(q[0], q[1]);
    else ctx.lineTo(q[0], q[1]);
  }
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px.toFixed(1)}px`;
  } catch {
    // 일부 브라우저는 지원하지 않는다
  }
}

// ───────── 스틱 기하: 카메라 좌표의 축 표본과 윤곽 방향(프레임 안에서 재사용하는 작업 공간) ─────────

const G = {
  a: [0, 0, 1] as Vec3,
  fc: [0, 0, 1] as Vec3,
  pc: new Float64Array(SAMPLE_COUNT * 3),
  sd: new Float64Array(SAMPLE_COUNT * 3),
};

function geom(cam: StageCamera, pose: Pick<StickPose, 'fulcrum' | 'direction'>): void {
  const a = dirToCamera(cam, pose.direction);
  const fc = toCamera(cam, pose.fulcrum);
  G.a = a;
  G.fc = fc;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const o = i * SAMPLE_STEP - FULCRUM_S;
    const px = fc[0] + a[0] * o;
    const py = fc[1] + a[1] * o;
    const pz = fc[2] + a[2] * o;
    // 윤곽 방향 = 축 × (표본에서 눈으로 가는 방향)
    const sx = a[1] * -pz - a[2] * -py;
    const sy = a[2] * -px - a[0] * -pz;
    const sz = a[0] * -py - a[1] * -px;
    const l = Math.hypot(sx, sy, sz) || 1;
    G.pc[i * 3] = px;
    G.pc[i * 3 + 1] = py;
    G.pc[i * 3 + 2] = pz;
    G.sd[i * 3] = sx / l;
    G.sd[i * 3 + 1] = sy / l;
    G.sd[i * 3 + 2] = sz / l;
  }
}

const samplePoint = (i: number): Vec3 => [G.pc[i * 3], G.pc[i * 3 + 1], G.pc[i * 3 + 2]];
const sampleSide = (i: number): Vec3 => [G.sd[i * 3], G.sd[i * 3 + 1], G.sd[i * 3 + 2]];

// 표본 i에서 윤곽 방향 쪽으로 반지름 × u만큼 간 점의 화면 좌표
function edge(cam: StageCamera, i: number, u: number, out: [number, number]): void {
  const k = SAMPLE_RADII[i] * u;
  const z = G.pc[i * 3 + 2] + G.sd[i * 3 + 2] * k;
  out[0] = cam.offsetX + (cam.scale * (G.pc[i * 3] + G.sd[i * 3] * k)) / z;
  out[1] = cam.offsetY - (cam.scale * (G.pc[i * 3 + 1] + G.sd[i * 3 + 1] * k)) / z;
}

const tmp: [number, number] = [0, 0];

interface TipShape {
  p: [number, number];
  ang: number;
  ra: number;
  rb: number;
}

function tipShape(cam: StageCamera): TipShape {
  const o = TIP_C - FULCRUM_S;
  const tc: Vec3 = [G.fc[0] + G.a[0] * o, G.fc[1] + G.a[1] * o, G.fc[2] + G.a[2] * o];
  const p = projectCamera(cam, tc);
  const q = projectCamera(cam, [tc[0] + G.a[0], tc[1] + G.a[1], tc[2] + G.a[2]]);
  const k = cam.scale / tc[2];
  const v = norm([-tc[0], -tc[1], -tc[2]]);
  const av = dot(G.a, v);
  return {
    p,
    ang: Math.atan2(q[1] - p[1], q[0] - p[0]),
    ra: Math.max(TIP_R, TIP_HL * Math.sqrt(Math.max(0, 1 - av * av))) * k,
    rb: TIP_R * k,
  };
}

// 잔상: 한 가지 색으로 칠한 윤곽
function silhouette(ctx: CanvasRenderingContext2D, cam: StageCamera, pose: StickPose, color: string): void {
  geom(cam, pose);
  ctx.beginPath();
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    edge(cam, i, -1, tmp);
    if (i === 0) ctx.moveTo(tmp[0], tmp[1]);
    else ctx.lineTo(tmp[0], tmp[1]);
  }
  for (let i = SAMPLE_COUNT - 1; i >= 0; i--) {
    edge(cam, i, 1, tmp);
    ctx.lineTo(tmp[0], tmp[1]);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  const T = tipShape(cam);
  ctx.beginPath();
  ctx.ellipse(T.p[0], T.p[1], T.ra, T.rb, T.ang, 0, TAU);
  ctx.fill();
}

// 띠 경계 화면 좌표(작업 공간). 최대 띠 수 18
const MAX_BANDS = 18;
const EX = Array.from({ length: MAX_BANDS + 1 }, () => new Float32Array(SAMPLE_COUNT));
const EY = Array.from({ length: MAX_BANDS + 1 }, () => new Float32Array(SAMPLE_COUNT));

// 스틱 한 자루. 조명은 받침점 표본 기준으로 스틱마다 한 번 계산한다. 표시등 화면 위치를 돌려준다.
function drawStick(
  ctx: CanvasRenderingContext2D,
  cam: StageCamera,
  pose: StickPose,
  col: Vec3,
  bands: number,
  ledPulse: number,
): [number, number] {
  const M = bands;
  geom(cam, pose);
  const rim = rimColor(col);
  const rimGraphite = rimColor(GRAPHITE);

  // 띠 경계의 화면 좌표
  for (let j = 0; j <= M; j++) {
    const u = Math.sin(-Math.PI / 2 + (Math.PI * j) / M);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      edge(cam, i, u, tmp);
      EX[j][i] = tmp[0];
      EY[j][i] = tmp[1];
    }
  }

  // 받침점 표본 기준의 시선·옆·정면 방향 (스틱마다 한 번)
  const im = Math.round(FULCRUM_S / SAMPLE_STEP);
  const pm = samplePoint(im);
  const view = norm([-pm[0], -pm[1], -pm[2]]);
  const side = sampleSide(im);
  const front = norm(cross(side, G.a));
  const bodyCols: string[] = [];
  const collarCols: string[] = [];
  const ledCols: string[] = [];
  for (let j = 0; j < M; j++) {
    const th = -Math.PI / 2 + (Math.PI * (j + 0.5)) / M;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const N: Vec3 = [
      front[0] * cs + side[0] * sn,
      front[1] * cs + side[1] * sn,
      front[2] * cs + side[2] * sn,
    ];
    bodyCols.push(css(shadeBand(col, N, view, cam.keyLight, cam.fillLight, GLOSS_FINISH, rim)));
    collarCols.push(css(shadeBand(GRAPHITE, N, view, cam.keyLight, cam.fillLight, COLLAR_FINISH, rimGraphite)));
    const e = (0.55 + 0.75 * ledPulse) * (0.7 + 0.3 * cs);
    const add2 = 0.25 * ledPulse;
    ledCols.push(css([col[0] * e + add2, col[1] * e + add2, col[2] * e + add2]));
  }

  for (const sg of MATERIAL_SEGMENTS) {
    const i1 = Math.min(SAMPLE_COUNT - 1, sg.i1 + 1);
    const cols = sg.kind === 'collar' ? collarCols : sg.kind === 'led' ? ledCols : bodyCols;
    for (let j = 0; j < M; j++) {
      ctx.beginPath();
      ctx.moveTo(EX[j][sg.i0], EY[j][sg.i0]);
      for (let i = sg.i0 + 1; i <= i1; i++) ctx.lineTo(EX[j][i], EY[j][i]);
      for (let i = i1; i >= sg.i0; i--) ctx.lineTo(EX[M][i], EY[M][i]);
      ctx.closePath();
      ctx.fillStyle = cols[j];
      ctx.fill();
    }
  }

  // 팁: 음영 준 타원체
  const T = tipShape(cam);
  const hx = cam.keyLight[0] * 0.5;
  const hy = -cam.keyLight[1] * 0.5;
  const ca = Math.cos(T.ang);
  const sa = Math.sin(T.ang);
  ctx.save();
  ctx.translate(T.p[0], T.p[1]);
  ctx.rotate(T.ang);
  ctx.scale(T.ra, T.rb);
  const gr = ctx.createRadialGradient(ca * hx + sa * hy, -sa * hx + ca * hy, 0.04, 0, 0, 1);
  const hi = GLOSS_FINISH.ks * 0.55;
  gr.addColorStop(0, css([col[0] * 1.05 + hi, col[1] * 1.05 + hi, col[2] * 1.05 + hi]));
  gr.addColorStop(0.42, css(mul(col, 0.86)));
  gr.addColorStop(1, css(mul(col, 0.24)));
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.restore();

  // 손잡이 끝 단면(카메라 쪽을 볼 때만)
  const pb = samplePoint(0);
  const vb = norm([-pb[0], -pb[1], -pb[2]]);
  const avb = dot(G.a, vb);
  if (avb < -0.05) {
    const c0 = projectCamera(cam, pb);
    const c1 = projectCamera(cam, samplePoint(1));
    const ang = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]);
    const k = cam.scale / pb[2];
    ctx.beginPath();
    ctx.ellipse(c0[0], c0[1], Math.max(0.5, HANDLE_R * 0.84 * k * -avb), HANDLE_R * 0.84 * k, ang, 0, TAU);
    ctx.fillStyle = css(mul(col, 0.5));
    ctx.fill();
  }

  // 표시등 번짐
  const il = Math.round((LED_START + 0.3) / SAMPLE_STEP);
  const pl = samplePoint(il);
  const sl = projectCamera(cam, pl);
  const rl = HANDLE_R * 3.4 * (cam.scale / pl[2]);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(sl[0], sl[1], 0, sl[0], sl[1], rl);
  lg.addColorStop(0, css(col, 0.16 + 0.5 * ledPulse));
  lg.addColorStop(1, css(col, 0));
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.arc(sl[0], sl[1], rl, 0, TAU);
  ctx.fill();
  ctx.restore();
  return sl;
}

// 바닥 그림자: 주광 방향으로 투영한 선을 흐리게 번지게 한다. 팁이 높을수록 흐리고 옅다.
function drawShadow(ctx: CanvasRenderingContext2D, cam: StageCamera, pose: StickPose, dpr: number): void {
  const OFF = 6000;
  const tipY = pointOnAxis(pose, TIP_C)[1];
  const alpha = 0.6 * (1 - 0.7 * clamp01(tipY / 30));
  const blur = (2.5 + tipY * 0.55) * dpr;
  let wsum = 0;
  let wn = 0;
  ctx.save();
  ctx.translate(-OFF, 0);
  ctx.beginPath();
  for (let s = 0; s <= L_TOTAL; s += 3.4) {
    const A = pointOnAxis(pose, s);
    const t = A[1] / KEY_LIGHT_WORLD[1];
    const ground: Vec3 = [A[0] - KEY_LIGHT_WORLD[0] * t, 0, A[2] - KEY_LIGHT_WORLD[2] * t];
    const c = toCamera(cam, ground);
    const q = projectCamera(cam, c);
    wsum += (cam.scale / c[2]) * radiusAt(Math.min(s, NECK));
    wn++;
    if (s === 0) ctx.moveTo(q[0], q[1]);
    else ctx.lineTo(q[0], q[1]);
  }
  ctx.shadowColor = `rgba(0,0,0,${alpha.toFixed(3)})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = OFF * dpr;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(1.5, (wsum / wn) * 1.8);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.restore();
}

// ───────── 한 프레임 ─────────

export function drawStage(ctx: CanvasRenderingContext2D, f: StageFrame): void {
  const { layout, width: W, height: H, dpr, t, step, poses, hits, layers, brand } = f;
  const cam = layout.camera;
  const pads = layout.pads;
  const main = pads[layout.mainPad];
  const u = W / 520;
  const bands = W >= 400 ? 18 : 12;
  const fontOf = (weight: number, px: number): string => `${weight} ${Math.max(MIN_FONT_PX, px).toFixed(1)}px ${f.font}`;
  const base = (): void => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  base();
  ctx.clearRect(0, 0, W, H);

  // 무대 빛
  const mc = project(cam, main.center);
  let pulse = 0;
  for (const h of hits) pulse += h.strength * Math.exp(-(t - h.time) / 0.22);
  // 반지름을 가장 가까운 가장자리까지로 잡아 캔버스 경계에서 빛이 잘려 네모로 보이지 않게 한다
  const glowR = Math.max(1, Math.min(mc[0], W - mc[0], mc[1], H - mc[1]));
  let g = ctx.createRadialGradient(mc[0], mc[1], 0, mc[0], mc[1], glowR);
  g.addColorStop(0, css(brand, 0.06 + 0.07 * Math.min(1, pulse)));
  g.addColorStop(1, css(brand, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 바닥 빛
  planeTransform(ctx, cam, main.center, dpr);
  // 반지름 34cm: 패드 바깥 끝(약 31.5cm)은 덮고 무대 좌우 경계(약 36cm) 안에서 사라진다
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, FLOOR_LIGHT_R);
  g.addColorStop(0, 'rgba(255,255,255,.085)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, FLOOR_LIGHT_R, 0, TAU);
  ctx.fill();
  base();

  // 패드와 이름
  const far = norm([cam.forward[0], 0, cam.forward[2]]);
  pads.forEach((p, idx) => {
    const a = idx === layout.mainPad ? 0.55 + 0.45 * layers.pad : layers.pad;
    if (a < 0.01) return;
    let flash = 0;
    for (const h of hits) {
      if (h.padIndex !== idx || t < h.time) continue;
      flash = Math.max(flash, h.strength * Math.exp(-(t - h.time) / 0.14));
    }
    circlePath(ctx, cam, p.center, p.radius);
    ctx.fillStyle = `rgba(255,255,255,${(0.045 * a).toFixed(3)})`;
    ctx.fill();
    if (flash > 0.01) {
      ctx.fillStyle = css(brand, 0.2 * flash * a);
      ctx.fill();
    }
    ctx.strokeStyle = css(mix3(WHITE, brand, flash * 0.6), (0.22 + 0.6 * flash) * a);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    circlePath(ctx, cam, p.center, p.radius * 0.84);
    ctx.strokeStyle = `rgba(255,255,255,${(0.06 * a).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (layers.pad > 0.02) {
      const lp = project(cam, [p.center[0] + far[0] * p.radius * 0.6, 0, p.center[2] + far[2] * p.radius * 0.6]);
      ctx.font = fontOf(700, 10.5 * u);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      setLetterSpacing(ctx, 1.4 * u);
      ctx.fillStyle = css(mix3([0.56, 0.56, 0.58], WHITE, clamp01(flash * 1.4)), a * layers.pad);
      ctx.fillText(p.name, lp[0], lp[1]);
      setLetterSpacing(ctx, 0);
    }
  });

  // 바닥 위 빛: 번짐과 링
  ctx.globalCompositeOperation = 'lighter';
  for (const h of hits) {
    const age = t - h.time;
    if (age < 0) continue;
    const a = Math.min(1, h.strength * 1.05) * Math.exp(-age / 0.15);
    if (a > 0.01) {
      planeTransform(ctx, cam, h.hitPoint, dpr);
      const rb = 7 + 11 * h.strength;
      const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, rb);
      bg.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
      bg.addColorStop(0.22, css(brand, a * 0.85));
      bg.addColorStop(0.6, css(brand, a * 0.25));
      bg.addColorStop(1, css(brand, 0));
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0, 0, rb, 0, TAU);
      ctx.fill();
      base();
    }
    const ring = (x: number, k: number, al: number): void => {
      if (x <= 0 || x >= 1) return;
      circlePath(ctx, cam, h.hitPoint, (2.2 + (9 + 15 * h.strength) * easeOutCubic(x)) * k);
      ctx.strokeStyle = css(mix3(brand, WHITE, 0.45), al * h.strength * Math.pow(1 - x, 1.7));
      ctx.lineWidth = 1.4;
      ctx.stroke();
    };
    ring(age / 0.62, 1, 0.85);
    if (h.strength > 0.9) ring((age - 0.08) / 0.72, 1.5, 0.4);
  }
  ctx.globalCompositeOperation = 'source-over';

  // 그림자
  for (const p of poses) drawShadow(ctx, cam, p, dpr);

  // 스윙 궤적(첫 스틱의 팁이 그리는 호)
  if (layers.imu > 0.005) {
    const p0 = poses[0];
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const th = (MAX_THETA * i) / 20;
      const phi = CONTACT_PHI + th;
      const c = Math.cos(phi);
      const q = project(
        cam,
        pointOnAxis(
          {
            fulcrum: [p0.fulcrum[0], FULCRUM_Y + LIFT * (th / MAX_THETA), p0.fulcrum[2]],
            direction: [p0.heading[0] * c, Math.sin(phi), p0.heading[2] * c],
          },
          TIP_C,
        ),
      );
      if (i === 0) ctx.moveTo(q[0], q[1]);
      else ctx.lineTo(q[0], q[1]);
    }
    ctx.setLineDash([3 * u, 6 * u]);
    ctx.strokeStyle = `rgba(255,255,255,${(0.32 * layers.imu).toFixed(3)})`;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 스틱(먼 것부터), 내려칠 때만 잔상
  const order = poses
    .map((p, i) => ({ i, z: toCamera(cam, p.fulcrum)[2] }))
    .sort((a, b) => b.z - a.z);
  const leds: Array<[number, number]> = [];
  for (const it of order) {
    const i = it.i;
    const p = poses[i];
    const prev = poseAt(layout, i, t - 0.01, step);
    const speed = Math.abs(p.theta - prev.theta) / 0.01;
    const ga = clamp01((speed - 3) / 9) * 0.24;
    if (ga > 0.01 && p.period === prev.period) {
      silhouette(ctx, cam, poseAt(layout, i, t - 0.024, step), css(brand, ga * 0.4));
      silhouette(ctx, cam, poseAt(layout, i, t - 0.012, step), css(brand, ga * 0.75));
    }
    let lp = 0;
    for (const h of hits) if (h.stick === i) lp = Math.max(lp, Math.exp(-(t - h.time) / 0.2));
    leds[i] = drawStick(ctx, cam, p, brand, bands, lp);
  }

  // 팁 섬광
  ctx.globalCompositeOperation = 'lighter';
  for (const h of hits) {
    const age = t - h.time;
    const a = h.strength * Math.exp(-age / 0.06);
    if (a < 0.02) continue;
    const c = toCamera(cam, [h.hitPoint[0], TIP_R, h.hitPoint[2]]);
    const q = projectCamera(cam, c);
    const rr = (3.5 + 3.5 * h.strength) * (cam.scale / c[2]);
    const tg = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], rr);
    tg.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    tg.addColorStop(0.35, css(brand, a * 0.5));
    tg.addColorStop(1, css(brand, 0));
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(q[0], q[1], rr, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // 센서 축: 층 투명도가 평소(0.25)를 넘는 만큼만 보인다(단계 0)
  const gizA = clamp01((layers.imu - 0.25) / 0.75);
  if (gizA > 0.02) {
    const p0 = poses[0];
    const sideAxis = norm(cross([0, 1, 0], p0.direction));
    const upAxis = cross(p0.direction, sideAxis);
    const og = add(pointOnAxis(p0, 6.2), mul(upAxis, 1.5));
    const oq = project(cam, og);
    ctx.font = fontOf(600, 11 * u);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const axes: Array<[string, Vec3, number]> = [
      ['X', sideAxis, 6.5],
      ['Y', p0.direction, 8],
      ['Z', upAxis, 6.5],
    ];
    for (const [label, dir, len] of axes) {
      const e = project(cam, add(og, mul(dir, len)));
      const l = project(cam, add(og, mul(dir, len + 2.2)));
      ctx.beginPath();
      ctx.moveTo(oq[0], oq[1]);
      ctx.lineTo(e[0], e[1]);
      ctx.strokeStyle = `rgba(255,255,255,${(0.8 * gizA).toFixed(3)})`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.fillStyle = `rgba(200,200,205,${gizA.toFixed(3)})`;
      ctx.fillText(label, l[0], l[1]);
    }
    ctx.beginPath();
    ctx.arc(oq[0], oq[1], 2.2 * u, 0, TAU);
    ctx.fillStyle = `rgba(255,255,255,${gizA.toFixed(3)})`;
    ctx.fill();
  }

  // 블루투스로 화면에 전달
  if (layers.ble > 0.02) {
    const a = layers.ble;
    const cw = 136 * u;
    const ch = 82 * u;
    const cx = W - cw - 4 * u;
    const cy = 4 * u;
    const ax = cx + 10 * u;
    const ay = cy + ch + 4 * u;
    const curve = (from: [number, number], x: number): [number, number] => {
      const mx = (from[0] + ax) / 2 + 26 * u;
      const my = Math.min(from[1], ay) - 26 * u;
      const k = 1 - x;
      return [k * k * from[0] + 2 * k * x * mx + x * x * ax, k * k * from[1] + 2 * k * x * my + x * x * ay];
    };
    const lastStick = hits.length ? hits[hits.length - 1].stick : 0;
    const from = leds[lastStick] ?? leds[0];
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const q = curve(from, i / 24);
      if (i === 0) ctx.moveTo(q[0], q[1]);
      else ctx.lineTo(q[0], q[1]);
    }
    ctx.setLineDash([2 * u, 6 * u]);
    ctx.strokeStyle = `rgba(245,245,247,${(0.4 * a).toFixed(3)})`;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.setLineDash([]);
    for (const h of hits) {
      const age = t - h.time;
      if (age < 0 || age > BLE_TRAVEL) continue;
      const q = curve(leds[h.stick] ?? from, easeOutCubic(age / BLE_TRAVEL));
      ctx.globalCompositeOperation = 'lighter';
      const dg = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], 9 * u);
      dg.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
      dg.addColorStop(0.3, css(brand, 0.8 * a));
      dg.addColorStop(1, css(brand, 0));
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(q[0], q[1], 9 * u, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    const chip = bleChipName(hits, t);
    const fl = clamp01(Math.exp(-(t - chip.flashAt) / 0.25));
    ctx.globalAlpha = a;
    roundRect(ctx, cx, cy, cw, ch, 12 * u);
    ctx.fillStyle = '#1d1d1f';
    ctx.fill();
    ctx.strokeStyle = css(mix3([0.4, 0.4, 0.42], brand, fl), 0.5 + 0.5 * fl);
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(cx + 15 * u + i * 9 * u, cy + 13 * u, 2.6 * u, 0, TAU);
      ctx.fillStyle = '#48484a';
      ctx.fill();
    }
    roundRect(ctx, cx + 12 * u, cy + 25 * u, cw - 24 * u, ch - 37 * u, 6 * u);
    ctx.fillStyle = '#2c2c2e';
    ctx.fill();
    ctx.fillStyle = '#f5f5f7';
    ctx.font = fontOf(700, 13 * u);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(chip.name, cx + cw / 2, cy + 25 * u + (ch - 37 * u) / 2 + 0.5 * u);
    ctx.globalAlpha = 1;
  }
}
