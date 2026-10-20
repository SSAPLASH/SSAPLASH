// 센서 튜닝 순수 계산 검증: 세기 곡선 경계·단조성, 범위 보정, 반경 재계산, 기본값.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SENSOR_TUNING,
  TUNING_RANGES,
  accelToVelocity,
  applyRadiusTuning,
  clampTuning,
  countChangedTuning,
  mergeTuning,
} from './tuning';
import { createEmptyProfile, type CalibrationProfile } from './calibration';

const CURVE = DEFAULT_SENSOR_TUNING.velocity;

function profile(): CalibrationProfile {
  const p = createEmptyProfile('pointer');
  p.anchors = {
    SNARE: { pad: 'SNARE', pitch: 0, yaw: -20, radius: 5, samples: 7, spread: 1.5 },
    HIHAT: { pad: 'HIHAT', pitch: 0, yaw: 20, radius: 5, samples: 9, spread: 2.5 },
  };
  return p;
}

describe('accelToVelocity', () => {
  it('min 이하는 1, max 이상은 127', () => {
    expect(accelToVelocity(0, CURVE)).toBe(1);
    expect(accelToVelocity(CURVE.minAccelG, CURVE)).toBe(1);
    expect(accelToVelocity(CURVE.maxAccelG, CURVE)).toBe(127);
    expect(accelToVelocity(100, CURVE)).toBe(127);
  });

  it('가속도가 커질수록 벨로시티는 줄지 않는다(단조 증가)', () => {
    let prev = 0;
    for (let g = 0; g <= 10; g += 0.1) {
      const v = accelToVelocity(g, CURVE);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('기본 곡선 값은 기존 InputManager 결과와 같다(동작 보존)', () => {
    expect(accelToVelocity(6.3, CURVE)).toBe(Math.max(1, Math.round(Math.pow((6.3 - 0.8) / (8 - 0.8), 0.8) * 127)));
  });

  it('maxAccelG를 올리면 같은 가속도의 벨로시티가 작아진다', () => {
    expect(accelToVelocity(8, { ...CURVE, maxAccelG: 16 })).toBeLessThan(127);
  });
});

describe('clampTuning', () => {
  it('범위 밖 값을 범위 안으로 자른다', () => {
    const c = clampTuning({ radiusFactor: 5, maxRadiusDeg: 0, sensorOffsetMs: -999, velocity: { gamma: 9 } });
    expect(c.radiusFactor).toBe(TUNING_RANGES.radiusFactor.max);
    expect(c.maxRadiusDeg).toBe(TUNING_RANGES.maxRadiusDeg.min);
    expect(c.sensorOffsetMs).toBe(TUNING_RANGES.sensorOffsetMs.min);
    expect(c.velocity?.gamma).toBe(TUNING_RANGES.gamma.max);
  });

  it('주어진 항목만 돌려준다(부분 갱신)', () => {
    expect(clampTuning({ radiusFactor: 0.6 })).toEqual({ radiusFactor: 0.6 });
  });

  it('숫자가 아닌 값·알 수 없는 정책은 버린다', () => {
    const c = clampTuning({ radiusFactor: NaN, outsidePolicy: 'x' as never });
    expect(c).toEqual({});
  });

  it('maxAccelG ≤ minAccelG면 minAccelG + 0.5', () => {
    expect(clampTuning({ velocity: { minAccelG: 3, maxAccelG: 2 } }).velocity).toEqual({ minAccelG: 3, maxAccelG: 3.5 });
    expect(clampTuning({ velocity: { minAccelG: 3, maxAccelG: 3 } }).velocity?.maxAccelG).toBe(3.5);
  });
});

describe('mergeTuning', () => {
  it('부분 값을 병합하고 나머지는 유지한다', () => {
    const t = mergeTuning(DEFAULT_SENSOR_TUNING, { radiusFactor: 0.6, velocity: { gamma: 1 } });
    expect(t.radiusFactor).toBe(0.6);
    expect(t.velocity).toEqual({ ...CURVE, gamma: 1 });
    expect(t.maxRadiusDeg).toBe(DEFAULT_SENSOR_TUNING.maxRadiusDeg);
  });

  it('min만 올려 기존 max와 겹치면 max를 min + 0.5로 올린다', () => {
    const t = mergeTuning({ ...DEFAULT_SENSOR_TUNING, velocity: { ...CURVE, maxAccelG: 2 } }, { velocity: { minAccelG: 3 } });
    expect(t.velocity.minAccelG).toBe(3);
    expect(t.velocity.maxAccelG).toBe(3.5);
  });
});

describe('applyRadiusTuning', () => {
  it('null은 그대로 통과', () => {
    expect(applyRadiusTuning(null, DEFAULT_SENSOR_TUNING)).toBeNull();
  });

  it('반경만 재계산하고 중심·샘플 수·퍼짐은 유지한다', () => {
    const p = profile();
    const out = applyRadiusTuning(p, { ...DEFAULT_SENSOR_TUNING, radiusFactor: 0.5, maxRadiusDeg: 30 })!;
    expect(out.anchors.SNARE?.radius).toBeCloseTo(20); // 40 × 0.5
    expect(out.anchors.HIHAT?.radius).toBeCloseTo(20);
    expect(out.anchors.SNARE).toMatchObject({ pitch: 0, yaw: -20, samples: 7, spread: 1.5 });
    expect(out.anchors.HIHAT).toMatchObject({ samples: 9, spread: 2.5 });
    expect(out.maxRadiusDeg).toBe(30);
    expect(out.id).toBe(p.id);
  });

  it('상한이 반경보다 작으면 상한이 이긴다', () => {
    const out = applyRadiusTuning(profile(), { ...DEFAULT_SENSOR_TUNING, radiusFactor: 0.8, maxRadiusDeg: 10 })!;
    expect(out.anchors.SNARE?.radius).toBe(10);
  });

  it('원본 프로필은 바뀌지 않는다', () => {
    const p = profile();
    applyRadiusTuning(p, { ...DEFAULT_SENSOR_TUNING, radiusFactor: 0.3 });
    expect(p.anchors.SNARE?.radius).toBe(5);
    expect(p.maxRadiusDeg).toBe(22);
  });

  it('기본 튜닝이면 기존 0.55 계산과 같다', () => {
    const out = applyRadiusTuning(profile(), DEFAULT_SENSOR_TUNING)!;
    expect(out.anchors.SNARE?.radius).toBeCloseTo(22); // 40 × 0.55 = 22 = 상한
  });
});

describe('기본값', () => {
  it('기본 튜닝은 변경 항목 0, 하나 바꾸면 1', () => {
    expect(countChangedTuning(DEFAULT_SENSOR_TUNING)).toBe(0);
    expect(countChangedTuning(mergeTuning(DEFAULT_SENSOR_TUNING, { outsidePolicy: 'nearest' }))).toBe(1);
  });

  it('기본값은 모두 슬라이더 범위 안이다', () => {
    const d = DEFAULT_SENSOR_TUNING;
    expect(clampTuning(d)).toEqual(d);
  });
});
