// 최고 기록 갱신 축하의 색종이(결과 화면 전체). 순수 함수 — 같은 seq·화면 크기면 같은 조각, 조각 위치는 시각의 닫힌 식이라 프레임 누적 오차가 없다.
// 움직임: 가운데 아래에서 부채꼴로 한 번 터지고(폭죽), 곧이어 양쪽 아래 모서리에서 안쪽 위로 쏜 뒤, 공기 저항으로 느려지며 팔랑팔랑 떨어진다.
import { createRand } from '@/domain/hitFx/rand';

export type ConfettiShape = 'rect' | 'circle' | 'ribbon';

export interface ConfettiPiece {
  /** 시작 위치(CSS px) */
  x0: number;
  y0: number;
  /** 처음 속도(px/s). 위쪽이 음수 */
  vx: number;
  vy: number;
  /** 축하 시작부터 이 조각이 나오기까지(ms) */
  delayMs: number;
  /** 나온 뒤 사라질 때까지(ms) */
  lifeMs: number;
  /** 조각 크기(px) */
  w: number;
  h: number;
  color: string;
  shape: ConfettiShape;
  /** 처음 기울기(rad)와 도는 속도(rad/s) */
  rot0: number;
  spin: number;
  /** 뒤집힘(팔랑임) 처음 위상(rad)과 초당 횟수 */
  flip0: number;
  flipHz: number;
  /** 좌우 흔들림 폭(px)과 초당 횟수 */
  swayAmp: number;
  swayHz: number;
}

export interface ConfettiPose {
  x: number;
  y: number;
  rot: number;
  /** -1~1. 세로 방향 배율(종이가 뒤집히는 모습). 음수면 뒷면 */
  flip: number;
  alpha: number;
}

/** 선명한 7색(분홍·주황·노랑·초록·하늘·남보라·보라) */
export const CONFETTI_COLORS: readonly string[] = ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#5e5ce6', '#bf5af2'];

/** 공기 저항(1/s)과 중력(px/s²). 끝 속도 = 중력 ÷ 저항 = 250px/s로 천천히 떨어진다 */
export const CONFETTI_DRAG = 2.2;
export const CONFETTI_GRAVITY = 550;
/** 가운데 폭죽 조각 수, 양쪽 모서리 한쪽 조각 수 */
export const CONFETTI_CENTER = 90;
export const CONFETTI_SIDE = 50;
/** 양쪽 모서리가 터지는 시각(ms) */
export const CONFETTI_SIDE_DELAY_MS = 180;
/** 조각 수명 범위(ms)와 끝에서 흐려지는 시간(ms) */
export const CONFETTI_LIFE_MIN_MS = 2200;
export const CONFETTI_LIFE_MAX_MS = 3200;
export const CONFETTI_FADE_MS = 500;
/** 모든 조각이 사라지는 시각(ms) 상한 */
export const CONFETTI_END_MS = CONFETTI_SIDE_DELAY_MS + 120 + CONFETTI_LIFE_MAX_MS;

const TAU = Math.PI * 2;
const SHAPES: readonly ConfettiShape[] = ['rect', 'rect', 'rect', 'circle', 'ribbon'];

/** 화면(w×h)에 맞춘 색종이 조각 목록. 속도는 화면 높이에 비례해 큰 화면에서도 같은 비율로 퍼진다 */
export function createConfetti(seq: number, w: number, h: number): ConfettiPiece[] {
  const rand = createRand(seq);
  const out: ConfettiPiece[] = [];
  const add = (x0: number, y0: number, angle: number, reach: number, delayMs: number) => {
    // 저항이 있을 때 멀리 가는 거리 ≈ 속도 ÷ 저항 → 가고 싶은 거리(reach)에서 속도를 거꾸로 구한다
    const speed = reach * CONFETTI_DRAG;
    const shape = SHAPES[Math.floor(rand() * SHAPES.length)]!;
    const size = 8 + 8 * rand();
    out.push({
      x0,
      y0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      delayMs,
      lifeMs: Math.round(CONFETTI_LIFE_MIN_MS + (CONFETTI_LIFE_MAX_MS - CONFETTI_LIFE_MIN_MS) * rand()),
      w: shape === 'ribbon' ? 4 : size,
      h: shape === 'ribbon' ? size * 2.2 : shape === 'circle' ? size : size * 0.62,
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)]!,
      shape,
      rot0: rand() * TAU,
      spin: (rand() - 0.5) * 9,
      flip0: rand() * TAU,
      flipHz: 1.2 + 2.2 * rand(),
      swayAmp: 6 + 16 * rand(),
      swayHz: 0.5 + 0.9 * rand(),
    });
  };
  // 가운데 폭죽: 위쪽(-90°)을 중심으로 좌우 60°씩 부채꼴
  for (let i = 0; i < CONFETTI_CENTER; i++) {
    const angle = -Math.PI / 2 + (rand() - 0.5) * ((120 * Math.PI) / 180);
    add(w / 2 + (rand() - 0.5) * 40, h * 0.62, angle, h * (0.3 + 0.55 * rand()), Math.round(60 * rand()));
  }
  // 양쪽 아래 모서리: 안쪽 위(수평에서 62°)로, 좌우 16°씩 흩뜨린다
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < CONFETTI_SIDE; i++) {
      const lift = ((62 + (rand() - 0.5) * 32) * Math.PI) / 180;
      const angle = side === -1 ? -lift : -Math.PI + lift;
      add(side === -1 ? -10 : w + 10, h * 0.9, angle, h * (0.45 + 0.6 * rand()), CONFETTI_SIDE_DELAY_MS + Math.round(120 * rand()));
    }
  }
  return out;
}

/** 축하 시작 후 tMs 시각의 조각 모습. 아직 안 나왔거나 이미 사라졌으면 null */
export function confettiAt(p: ConfettiPiece, tMs: number): ConfettiPose | null {
  const local = tMs - p.delayMs;
  if (local < 0 || local >= p.lifeMs) return null;
  const t = local / 1000;
  const k = CONFETTI_DRAG;
  const e = (1 - Math.exp(-k * t)) / k;
  const terminal = CONFETTI_GRAVITY / k;
  // 흔들림은 터진 직후에는 없다가 0.6초에 걸쳐 커진다(쏘아 올릴 때는 곧게, 떨어질 때 팔랑팔랑)
  const sway = p.swayAmp * Math.min(1, t / 0.6) * Math.sin(TAU * p.swayHz * t);
  const left = p.lifeMs - local;
  return {
    x: p.x0 + p.vx * e + sway,
    y: p.y0 + (p.vy - terminal) * e + terminal * t,
    rot: p.rot0 + p.spin * t,
    flip: Math.cos(p.flip0 + TAU * p.flipHz * t),
    alpha: left >= CONFETTI_FADE_MS ? 1 : left / CONFETTI_FADE_MS,
  };
}
