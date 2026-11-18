// 3D 드럼셋 모델 검증(PLAY-004 D4): 손별 기본 앵커가 손마다 다르고, 반경이 튜닝 범위 안이며, 기본 배치가 화면 안에 있다.
import { describe, expect, it } from 'vitest';
import { anchorsToLayout, anchorToPoint, defaultHandAnchorSet, defaultHandAnchors, handPoseTo, moveAnchorsForPad, padPointOf, HAND_ORIGINS, PAD_POINTS } from './kitModel';
import { DEFAULT_KIT_LAYOUT } from './kitLayout';
import { poseToScreen } from './kitMapping';
import { STICK_PADS } from './pads';
import { DEFAULT_SENSOR_TUNING } from './calibration/tuning';

describe('handPoseTo', () => {
  it('정면·같은 높이 점은 (0, 0), 오른쪽은 방위 +, 위는 고도 +', () => {
    const o = HAND_ORIGINS[0];
    // 왼손 출발점은 x < 0, 오른손은 x > 0: 같은 스네어를 왼손은 오른쪽(+)으로, 오른손은 왼쪽(−)으로 본다
    expect(o[0]).toBeLessThan(0);
    expect(handPoseTo(0, 'SNARE').yaw).toBeGreaterThan(0);
    expect(handPoseTo(1, 'SNARE').yaw).toBeLessThan(0);
    // 심벌(z 높음)은 고도 +, 스네어(z 낮음)는 고도 −
    expect(PAD_POINTS.CRASH[2]).toBeGreaterThan(o[2]);
    expect(handPoseTo(0, 'CRASH').pitch).toBeGreaterThan(0);
    expect(handPoseTo(0, 'SNARE').pitch).toBeLessThan(0);
  });

  it('하이햇은 왼쪽(−), 라이드는 오른쪽(+)', () => {
    for (const hand of [0, 1] as const) {
      expect(handPoseTo(hand, 'HIHAT').yaw).toBeLessThan(0);
      expect(handPoseTo(hand, 'RIDE').yaw).toBeGreaterThan(0);
    }
  });
});

describe('defaultHandAnchors', () => {
  it('손마다 스틱 패드 7개, 페달은 없다', () => {
    const [l, r] = defaultHandAnchors();
    for (const h of [l, r]) {
      expect(Object.keys(h!).sort()).toEqual([...STICK_PADS].sort());
      expect(h!.KICK).toBeUndefined();
    }
  });

  it('왼손·오른손 표가 다르다(같은 패드의 방위각이 다름)', () => {
    const [l, r] = defaultHandAnchors();
    expect(l!.SNARE!.yaw).not.toBeCloseTo(r!.SNARE!.yaw);
    // 탐 두 개는 좌우 대칭으로 놓여 있어, 왼손이 스몰탐을 보는 방위와 오른손이 미드탐을 보는 방위가 반대다
    expect(l!.SMALL_TOM!.yaw).toBeCloseTo(-r!.MID_TOM!.yaw);
  });

  it('기본 배치(DEFAULT_KIT_LAYOUT)의 스틱 패드 자리는 모델 타격점을 두 손 가운데에서 본 방향과 같다', () => {
    const mid = [(HAND_ORIGINS[0][0] + HAND_ORIGINS[1][0]) / 2, (HAND_ORIGINS[0][1] + HAND_ORIGINS[1][1]) / 2, (HAND_ORIGINS[0][2] + HAND_ORIGINS[1][2]) / 2];
    const DEG = 180 / Math.PI;
    for (const [pad, p] of Object.entries(PAD_POINTS)) {
      const dx = p[0] - mid[0];
      const dy = p[1] - mid[1];
      const dz = p[2] - mid[2];
      const s = poseToScreen({ yaw: Math.atan2(dx, dy) * DEG, pitch: Math.atan2(dz, Math.hypot(dx, dy)) * DEG });
      const pl = DEFAULT_KIT_LAYOUT[pad as keyof typeof PAD_POINTS];
      expect(pl.x).toBeCloseTo(s.x, 2);
      expect(pl.y).toBeCloseTo(s.y, 2);
    }
  });

  it('반경은 튜닝 하한~상한 안이고 모델값 표시(samples 0)', () => {
    const t = DEFAULT_SENSOR_TUNING;
    for (const a of Object.values(defaultHandAnchorSet(1, t))) {
      expect(a!.radius).toBeGreaterThanOrEqual(t.minRadiusDeg);
      expect(a!.radius).toBeLessThanOrEqual(t.maxRadiusDeg);
      expect(a!.samples).toBe(0);
    }
  });

  it('튜닝을 바꾸면 반경이 따라간다', () => {
    const a = defaultHandAnchorSet(0, { ...DEFAULT_SENSOR_TUNING, minRadiusDeg: 8, maxRadiusDeg: 9 });
    for (const x of Object.values(a)) expect(x!.radius).toBeLessThanOrEqual(9);
  });
});

describe('anchorToPoint·padPointOf (UX-64 D8)', () => {
  it('모델 방향을 그대로 넣으면 모델 패드 좌표(cm)가 나온다(거리는 모델 가정값)', () => {
    const p = anchorToPoint(0, 'HIHAT', handPoseTo(0, 'HIHAT'))!;
    expect(p.x).toBeCloseTo(PAD_POINTS.HIHAT[0] * 100, 5);
    expect(p.y).toBeCloseTo(PAD_POINTS.HIHAT[1] * 100, 5);
    expect(p.z).toBeCloseTo(PAD_POINTS.HIHAT[2] * 100, 5);
    expect(anchorToPoint(0, 'KICK', { pitch: 0, yaw: 0 })).toBeNull();
  });

  it('padPointOf: 양손이면 평균, 한 손이면 그 손, 없으면 null', () => {
    const l = handPoseTo(0, 'SNARE');
    const r = handPoseTo(1, 'SNARE');
    const both = padPointOf('SNARE', [l, r])!;
    expect(both.x).toBeCloseTo(PAD_POINTS.SNARE[0] * 100, 5);
    expect(both.y).toBeCloseTo(PAD_POINTS.SNARE[1] * 100, 5);
    const left = padPointOf('SNARE', [l, undefined])!;
    expect(left.x).toBeCloseTo(PAD_POINTS.SNARE[0] * 100, 5);
    expect(padPointOf('SNARE', [undefined, undefined])).toBeNull();
  });
});

describe('moveAnchorsForPad (드래그 편집)', () => {
  const from = DEFAULT_KIT_LAYOUT.SNARE;
  const to = { x: 0.62, y: 0.4 };

  it('양손 앵커를 옮기면 유도 배치의 그 패드가 끈 자리와 같고 다른 패드는 그대로다', () => {
    const hands = defaultHandAnchors();
    const base = anchorsToLayout(hands, DEFAULT_KIT_LAYOUT);
    const moved = moveAnchorsForPad(hands, 'SNARE', base.SNARE, to);
    const layout = anchorsToLayout(moved, DEFAULT_KIT_LAYOUT);
    expect(layout.SNARE.x).toBeCloseTo(to.x, 3);
    expect(layout.SNARE.y).toBeCloseTo(to.y, 3);
    expect(layout.HIHAT).toEqual(base.HIHAT);
    // 반지름 등 다른 필드 보존, 원본 불변
    expect(moved[0]?.SNARE?.radius).toBe(hands[0]?.SNARE?.radius);
    expect(hands).toEqual(defaultHandAnchors());
  });

  it('한 손만 앵커가 있으면 그 손만 옮기고 다른 손은 null 그대로', () => {
    const [l] = defaultHandAnchors();
    const moved = moveAnchorsForPad([l, null], 'SNARE', anchorsToLayout([l, null], DEFAULT_KIT_LAYOUT).SNARE, to);
    expect(moved[1]).toBeNull();
    const layout = anchorsToLayout(moved, DEFAULT_KIT_LAYOUT);
    expect(layout.SNARE.x).toBeCloseTo(to.x, 6);
    expect(layout.SNARE.y).toBeCloseTo(to.y, 6);
  });

  it('그 패드 앵커가 없는 손·앵커가 전혀 없으면 그대로', () => {
    const [l, r] = defaultHandAnchors();
    const { SNARE: _omit, ...rest } = r!;
    const moved = moveAnchorsForPad([l, rest], 'SNARE', from, to);
    expect(moved[1]).toEqual(rest);
    expect(moved[0]?.SNARE?.yaw).not.toBe(l?.SNARE?.yaw);
    expect(moveAnchorsForPad([null, null], 'SNARE', from, to)).toEqual([null, null]);
  });

  it('스틱 패드가 아니면(KICK·HIHAT_PEDAL) 앵커를 바꾸지 않는다', () => {
    const hands = defaultHandAnchors();
    expect(moveAnchorsForPad(hands, 'KICK', from, to)).toEqual(hands);
    expect(moveAnchorsForPad(hands, 'HIHAT_PEDAL', from, to)).toEqual(hands);
  });
});
