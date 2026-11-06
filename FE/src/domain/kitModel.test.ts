// 3D 드럼셋 모델 검증(PLAY-004 D4): 손별 기본 앵커가 손마다 다르고, 반경이 튜닝 범위 안이며, 기본 배치가 화면 안에 있다.
import { describe, expect, it } from 'vitest';
import { defaultHandAnchorSet, defaultHandAnchors, defaultLayout, handPoseTo, HAND_ORIGINS, PAD_POINTS } from './kitModel';
import { ALL_PADS, STICK_PADS } from './pads';
import { DEFAULT_SENSOR_TUNING } from './tuning';

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
    expect(l!.SNARE!.yaw).toBeCloseTo(-r!.SNARE!.yaw); // 스네어는 정중앙이라 좌우 대칭
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

describe('defaultLayout', () => {
  it('패드 9개 전부, 위치는 0.05~0.95 안', () => {
    const l = defaultLayout();
    expect(Object.keys(l).sort()).toEqual([...ALL_PADS].sort());
    for (const pad of ALL_PADS) {
      for (const v of [l[pad].x, l[pad].y]) {
        expect(v).toBeGreaterThanOrEqual(0.05);
        expect(v).toBeLessThanOrEqual(0.95);
      }
      expect(l[pad].r).toBeGreaterThan(0);
    }
  });

  it('연주자 시점 배치: 하이햇은 왼쪽, 라이드는 오른쪽, 심벌은 위, 스네어는 아래', () => {
    const l = defaultLayout();
    expect(l.HIHAT.x).toBeLessThan(l.SNARE.x);
    expect(l.RIDE.x).toBeGreaterThan(l.SNARE.x);
    expect(l.CRASH.y).toBeLessThan(l.SNARE.y);
    expect(l.SMALL_TOM.x).toBeLessThan(l.MID_TOM.x);
  });
});
