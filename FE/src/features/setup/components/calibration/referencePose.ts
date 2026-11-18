// 시작 위치 보정 자세 안내 그림의 자세 계산(PLAY-004). DOM·React를 모른다.
// 그림 좌표계는 280×210, 위에서 본 그림의 가운데는 x=140이고 스틱은 손(y=136)에서 화면 쪽(위)으로 뻗는다.

/** 위 그림 가운데 x */
export const POSE_CENTER_X = 140;
/** 위 그림 손 높이 y */
export const POSE_HAND_Y = 136;
/** 위 그림 스틱 길이 */
export const POSE_STICK_LEN = 72;

/** 벌어진 자세: 가운데에서 손까지 거리 */
const OPEN_OFFSET = 36;
/** 모은 자세: 가운데에서 손까지 거리 */
const CLOSED_OFFSET = 14;
/** 벌어진 자세의 스틱 각(도, 바깥쪽) */
const OPEN_DEG = 26;
/** 옆 그림: 벌어진 자세에서 스틱이 처진 각(도) */
const SIDE_OPEN_DEG = 30;
/** 대기 동작 한 주기(ms) */
export const IDLE_CYCLE_MS = 4200;

/** 모은 자세에서 두 스틱 끝이 가운데에서 맞닿는 각(도, 안쪽) */
export const MEET_DEG = (Math.asin(CLOSED_OFFSET / POSE_STICK_LEN) * 180) / Math.PI;

export interface ReferencePose {
  /** 가운데에서 손까지 거리 */
  handOffset: number;
  /** 왼손 스틱 회전(도, 시계 방향 +). 손이 회전 중심 */
  leftDeg: number;
  /** 오른손 스틱 회전(도, 시계 방향 +) */
  rightDeg: number;
  /** 옆 그림 스틱 회전(도, 시계 방향 + = 끝이 처짐) */
  sideDeg: number;
  /** 끝이 모인 정도 0~1. 가운데 점선과 끝의 밝은 점 진하기 */
  near: number;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
/** 부드러운 가감속 */
const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * u: 0 = 손이 벌어지고 스틱이 바깥을 향함, 1 = 손이 모이고 스틱 끝이 맞닿음(∧).
 * jitterDeg: 흔들림(도). 두 스틱이 조금 다르게 떨린다.
 */
export function poseAt(u: number, jitterDeg = 0): ReferencePose {
  const p = clamp01(u);
  const a = lerp(-OPEN_DEG, MEET_DEG, p);
  return {
    handOffset: lerp(OPEN_OFFSET, CLOSED_OFFSET, p),
    leftDeg: a + jitterDeg,
    rightDeg: -a + jitterDeg * 0.7,
    sideDeg: lerp(SIDE_OPEN_DEG, 0, p) + jitterDeg,
    near: clamp01((p - 0.8) / 0.2),
  };
}

/** 대기 동작: 잠깐 멈춤(10%) → 모임(35%) → 유지(43%) → 풀림(12%) */
export function idleProgress(nowMs: number): number {
  const ph = (((nowMs % IDLE_CYCLE_MS) + IDLE_CYCLE_MS) % IDLE_CYCLE_MS) / IDLE_CYCLE_MS;
  if (ph < 0.1) return 0;
  if (ph < 0.45) return ease((ph - 0.1) / 0.35);
  if (ph < 0.88) return 1;
  return 1 - ease((ph - 0.88) / 0.12);
}

/** 흔들림 상태의 떨림 각(도) */
export function shakyJitter(nowMs: number): number {
  return Math.sin(nowMs / 70) * 4;
}
