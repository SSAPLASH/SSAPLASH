// 랜딩 스틱의 박자·스트로크 각도 곡선·시각에서 구하는 포즈와 타격 목록. 상태를 보관하지 않는다.

import { CONTACT_PHI, FULCRUM_S, FULCRUM_Y } from './stickModel';
import type { StageHit, StageLayout, StageStep, StickPose } from './stickLayout';
import { add, clamp01, lerp, mod, mul, norm, rad, type Vec3 } from './stickSpace';

// 92bpm 8분음표 길이(초). 두 손이 번갈아 치므로 한 손의 주기는 2 × BEAT
export const BPM = 92;
export const BEAT = 60 / BPM / 2;

// 전체 타격 번호 기준 세기 순서
export const STRENGTH_CYCLE = [1, 0.58, 0.74, 0.58];

// 손 들림: 든 각에 비례해 받침점 높이에 최대 이만큼 더한다.
export const LIFT = 1.8;

// 준비 높이(라디안) = 20° + 26° × 다음 타격 세기
export const readyAngle = (strength: number): number => rad(20 + 26 * strength);
// 머묾 구간의 젖힘까지 포함한 최대 든 각
export const MAX_THETA = readyAngle(1) * 1.07;

// 패드 옮김이 끝나는 진행(이 구간 동안 다음 목표로 가속·감속 이동)
const MOVE_END = 0.56;
const UP_END = 0.6;
const DOWN_START = 0.76;

const easeInOut = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

// 전체 타격 번호 g의 세기(0~1)
export const strengthAt = (g: number): number => STRENGTH_CYCLE[mod(g, STRENGTH_CYCLE.length)];

// 한 스트로크의 든 각. tau는 주기 안의 진행(0~1), height는 준비 높이(라디안).
// 튕겨 오름 → 위에서 머묾(살짝 더 젖힘) → 가속해 내려침
export function strokeTheta(tau: number, height: number): number {
  if (tau < UP_END) return height * (1 - Math.pow(1 - tau / UP_END, 3.2));
  if (tau < DOWN_START)
    return height * (1 + 0.07 * Math.sin(Math.PI * ((tau - UP_END) / (DOWN_START - UP_END))));
  return height * (1 - Math.pow((tau - DOWN_START) / (1 - DOWN_START), 2.4));
}

// 스틱 stickIndex가 시각 t(초)에 어떤 자세인지
export function poseAt(
  layout: StageLayout,
  stickIndex: number,
  t: number,
  step: StageStep,
): StickPose {
  const stick = layout.sticks[stickIndex];
  const n = layout.sticks.length;
  const tt = (t - stick.index * BEAT) / (2 * BEAT);
  const k = Math.floor(tt);
  const tau = tt - k;
  const padOf = (kk: number): number =>
    step === 0 ? layout.mainPad : stick.sequence[mod(kk, stick.sequence.length)];
  const ia = padOf(k);
  const ib = padOf(k + 1);
  const A = stick.targets[ia];
  const B = stick.targets[ib];
  const m = easeInOut(clamp01(tau / MOVE_END));
  const heading = norm([
    lerp(A.heading[0], B.heading[0], m),
    0,
    lerp(A.heading[2], B.heading[2], m),
  ]);
  const hitIndex = k * n + stick.index;
  // 준비 높이는 다음 타격의 세기로 정한다.
  const height = readyAngle(strengthAt(hitIndex + n));
  const theta = strokeTheta(tau, height);
  const fulcrum: Vec3 = [
    lerp(A.fulcrum[0], B.fulcrum[0], m),
    FULCRUM_Y + LIFT * (theta / MAX_THETA),
    lerp(A.fulcrum[2], B.fulcrum[2], m),
  ];
  const phi = CONTACT_PHI + theta;
  const c = Math.cos(phi);
  return {
    fulcrum,
    heading,
    direction: [heading[0] * c, Math.sin(phi), heading[2] * c],
    theta,
    period: k,
    padIndex: ia,
    hitIndex,
  };
}

// 포즈의 축 위, 손잡이 끝에서 거리 s인 점
export function pointOnAxis(pose: Pick<StickPose, 'fulcrum' | 'direction'>, s: number): Vec3 {
  return add(pose.fulcrum, mul(pose.direction, s - FULCRUM_S));
}

// tStart < 시각 ≤ tEnd 인 타격을 시각 순으로 돌려준다.
// 스틱 i는 정수 k마다 시각 (2k + i) × BEAT 에 친다.
export function hitsBetween(
  layout: StageLayout,
  tStart: number,
  tEnd: number,
  step: StageStep,
): StageHit[] {
  const n = layout.sticks.length;
  const hits: StageHit[] = [];
  for (const stick of layout.sticks) {
    let k = Math.floor((tStart / BEAT - stick.index) / 2) - 1;
    for (;; k++) {
      const time = (2 * k + stick.index) * BEAT;
      if (time > tEnd) break;
      if (time <= tStart) continue;
      const padIndex =
        step === 0 ? layout.mainPad : stick.sequence[mod(k, stick.sequence.length)];
      hits.push({
        time,
        stick: stick.index,
        padIndex,
        hitPoint: stick.targets[padIndex].hitPoint,
        strength: strengthAt(k * n + stick.index),
        name: layout.pads[padIndex].name,
      });
    }
  }
  return hits.sort((a, b) => a.time - b.time);
}
