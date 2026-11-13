// 손별 앵커 → 판정 프로필·표시 배치 유도 검증(PLAY-004 D1·D2·D4).
import { describe, expect, it } from 'vitest';
import { anchorsToLayout, anchorsToProfile } from './kitJudge';
import { defaultHandAnchors } from './kitModel';
import { DEFAULT_KIT_LAYOUT } from './kitLayout';
import { DEFAULT_ANGLE_RANGE, poseToScreen, screenRadiusToDeg, radiusToScreen } from './kitMapping';
import { STICK_PADS, type PadId } from './pads';
import { DEFAULT_SENSOR_TUNING } from './calibration/tuning';
import type { HandAnchorSet, PadAnchor } from './calibration/calibration';

const anchor = (pad: PadId, pitch: number, yaw: number): PadAnchor => ({ pad, pitch, yaw, radius: 0, samples: 2, spread: 1 });

const hand: HandAnchorSet = {
  SNARE: anchor('SNARE', -20, 0),
  HIHAT: anchor('HIHAT', -5, -30),
  RIDE: anchor('RIDE', 20, 30),
};

describe('screenRadiusToDeg', () => {
  it('radiusToScreen의 역함수', () => {
    expect(radiusToScreen(screenRadiusToDeg(0.1))).toBeCloseTo(0.1);
    expect(screenRadiusToDeg(0.1, { yawDeg: 60, pitchDeg: 35 })).toBeCloseTo(12);
  });
});

describe('anchorsToProfile', () => {
  it('보정한 손: 앵커 중심은 그대로, 반경은 튜닝으로 다시 계산한다(source hits)', () => {
    const p = anchorsToProfile(hand, DEFAULT_SENSOR_TUNING, 0, '2026-11-06T00:00:00.000Z');
    expect(p).toMatchObject({ id: 'hits-0', source: 'hits', createdAt: '2026-11-06T00:00:00.000Z', maxRadiusDeg: 35 });
    expect(p.anchors.SNARE).toMatchObject({ pitch: -20, yaw: 0, samples: 2 });
    // 스네어 이웃 최소 각도 ≈ 33.5°(하이햇) × 0.6 ≈ 20 → 15~35 안
    expect(p.anchors.SNARE!.radius).toBeGreaterThan(15);
    expect(p.anchors.SNARE!.radius).toBeLessThan(35);
    expect(Object.keys(p.anchors).sort()).toEqual(['HIHAT', 'RIDE', 'SNARE']);
  });

  it('반경 하한·상한·계수가 튜닝을 따른다', () => {
    const p = anchorsToProfile(hand, { ...DEFAULT_SENSOR_TUNING, radiusFactor: 0.3, minRadiusDeg: 12, maxRadiusDeg: 14 }, 1);
    for (const a of Object.values(p.anchors)) {
      expect(a!.radius).toBeGreaterThanOrEqual(12);
      expect(a!.radius).toBeLessThanOrEqual(14);
    }
  });

  it('보정 안 된 손(null)은 3D 모델 기본 앵커(source model)로 스틱 패드 7개를 채운다', () => {
    const p = anchorsToProfile(null, DEFAULT_SENSOR_TUNING, 1);
    expect(p.source).toBe('model');
    expect(p.id).toBe('model-1');
    expect(Object.keys(p.anchors).sort()).toEqual([...STICK_PADS].sort());
    expect(p.anchors.KICK).toBeUndefined();
    const model = defaultHandAnchors()[1]!;
    expect(p.anchors.SNARE!.yaw).toBeCloseTo(model.SNARE!.yaw);
  });
});

describe('anchorsToLayout', () => {
  it('한 손만 있으면 그 손의 방향을 화면에 투영한다', () => {
    const l = anchorsToLayout([hand, null], DEFAULT_KIT_LAYOUT);
    const s = poseToScreen({ pitch: -20, yaw: 0 }, DEFAULT_ANGLE_RANGE);
    expect(l.SNARE.x).toBeCloseTo(s.x);
    expect(l.SNARE.y).toBeCloseTo(s.y);
  });

  it('양손이 있으면 벡터 평균 방향이다', () => {
    const right: HandAnchorSet = { SNARE: anchor('SNARE', -20, 20) };
    const l = anchorsToLayout([hand, right], DEFAULT_KIT_LAYOUT);
    const s = poseToScreen({ pitch: -20, yaw: 10 }, DEFAULT_ANGLE_RANGE);
    expect(l.SNARE.x).toBeCloseTo(s.x, 2);
    expect(l.SNARE.y).toBeCloseTo(s.y, 2);
  });

  it('없는 패드와 반지름·페달은 base 값을 유지한다', () => {
    const l = anchorsToLayout([hand, null], DEFAULT_KIT_LAYOUT);
    expect(l.CRASH).toEqual(DEFAULT_KIT_LAYOUT.CRASH);
    expect(l.KICK).toEqual(DEFAULT_KIT_LAYOUT.KICK);
    expect(l.SNARE.r).toBe(DEFAULT_KIT_LAYOUT.SNARE.r);
  });

  it('화면 밖 방향은 0.05~0.95로 자른다', () => {
    const far: HandAnchorSet = { RIDE: anchor('RIDE', 80, 170) };
    const l = anchorsToLayout([far, null], DEFAULT_KIT_LAYOUT);
    expect(l.RIDE.x).toBe(0.95);
    expect(l.RIDE.y).toBe(0.05);
  });
});
