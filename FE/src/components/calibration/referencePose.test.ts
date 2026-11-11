// 자세 안내 그림 계산 검증(PLAY-004): 모은 자세에서 스틱 끝이 가운데서 맞닿는지, 대기 주기 구간.
import { describe, expect, it } from 'vitest';
import { IDLE_CYCLE_MS, POSE_CENTER_X, POSE_STICK_LEN, idleProgress, poseAt } from './referencePose';

/** 손 위치에서 회전한 스틱 끝의 x */
function tipX(handX: number, deg: number): number {
  return handX + POSE_STICK_LEN * Math.sin((deg * Math.PI) / 180);
}

describe('poseAt', () => {
  it('모은 자세(1)에서 두 스틱 끝이 가운데 한 점에서 맞닿는다', () => {
    const p = poseAt(1);
    expect(p.handOffset).toBe(14);
    expect(tipX(POSE_CENTER_X - p.handOffset, p.leftDeg)).toBeCloseTo(POSE_CENTER_X, 6);
    expect(tipX(POSE_CENTER_X + p.handOffset, p.rightDeg)).toBeCloseTo(POSE_CENTER_X, 6);
    expect(p.sideDeg).toBe(0);
    expect(p.near).toBeCloseTo(1, 6);
  });

  it('벌어진 자세(0)에서 손은 넓고 스틱은 바깥을 향한다', () => {
    const p = poseAt(0);
    expect(p.handOffset).toBe(36);
    expect(p.leftDeg).toBe(-26);
    expect(p.rightDeg).toBe(26);
    expect(p.sideDeg).toBe(30);
    expect(p.near).toBe(0);
  });

  it('모이는 동안 손 간격이 줄어든다', () => {
    expect(poseAt(0.5).handOffset).toBeLessThan(poseAt(0.2).handOffset);
    expect(poseAt(0.9).handOffset).toBeLessThan(poseAt(0.5).handOffset);
  });

  it('범위를 벗어난 값은 0~1로 자른다', () => {
    expect(poseAt(-1)).toEqual(poseAt(0));
    expect(poseAt(2)).toEqual(poseAt(1));
  });

  it('흔들림 각은 두 스틱과 옆 그림에 더해진다', () => {
    const still = poseAt(1);
    const shaky = poseAt(1, 4);
    expect(shaky.leftDeg - still.leftDeg).toBeCloseTo(4, 6);
    expect(shaky.rightDeg - still.rightDeg).toBeCloseTo(2.8, 6);
    expect(shaky.sideDeg).toBeCloseTo(4, 6);
  });
});

describe('idleProgress', () => {
  it('주기 처음은 벌어진 채 멈춰 있고, 가운데 구간은 모은 채 유지한다', () => {
    expect(idleProgress(0)).toBe(0);
    expect(idleProgress(IDLE_CYCLE_MS * 0.05)).toBe(0);
    expect(idleProgress(IDLE_CYCLE_MS * 0.5)).toBe(1);
    expect(idleProgress(IDLE_CYCLE_MS * 0.87)).toBe(1);
  });

  it('모이는 구간은 오르고 풀리는 구간은 내려간다', () => {
    const a = idleProgress(IDLE_CYCLE_MS * 0.2);
    const b = idleProgress(IDLE_CYCLE_MS * 0.35);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(idleProgress(IDLE_CYCLE_MS * 0.95)).toBeLessThan(1);
  });

  it('주기가 되풀이된다', () => {
    expect(idleProgress(IDLE_CYCLE_MS * 1.3)).toBeCloseTo(idleProgress(IDLE_CYCLE_MS * 0.3), 6);
  });
});
