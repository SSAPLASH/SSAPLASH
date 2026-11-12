import { describe, expect, it } from 'vitest';
import {
  COLLAR_FINISH,
  CONTACT_PHI,
  FULCRUM_Y,
  GLOSS_FINISH,
  MATERIAL_SEGMENTS,
  REACH,
  SAMPLE_COUNT,
  SAMPLE_RADII,
  SAMPLE_STEP,
  TIP_R,
  materialAt,
  radiusAt,
  rimColor,
  shadeBand,
} from './stickModel';
import { norm, type Vec3 } from './stickSpace';

describe('radiusAt', () => {
  it('손잡이 끝은 1.0보다 작고 몸통 구간은 1.0이다', () => {
    expect(radiusAt(0)).toBeLessThan(1.0);
    expect(radiusAt(12)).toBeCloseTo(1.0, 9);
    expect(radiusAt(24)).toBeCloseTo(1.0, 9);
  });

  it('어깨 끝(37.2)은 0.48이다', () => {
    expect(radiusAt(37.2)).toBeCloseTo(0.48, 9);
  });

  it('센서 모듈 구간(3.6~9.0)은 1.15배다', () => {
    expect(radiusAt(3.6)).toBeCloseTo(1.15, 9);
    expect(radiusAt(6)).toBeCloseTo(1.15, 9);
    expect(radiusAt(9.0)).toBeCloseTo(1.15, 9);
    expect(radiusAt(9.6)).toBeCloseTo(1.0, 9);
  });

  it('어깨 구간에서 반지름이 줄어들기만 한다', () => {
    let prev = radiusAt(24);
    for (let s = 24.5; s <= 37.2; s += 0.5) {
      const r = radiusAt(s);
      expect(r).toBeLessThanOrEqual(prev + 1e-12);
      prev = r;
    }
  });
});

describe('materialAt / 재질 구간', () => {
  it('재질이 3.6·8.4·9.0에서 바뀐다', () => {
    expect(materialAt(3.5)).toBe('body');
    expect(materialAt(3.6)).toBe('collar');
    expect(materialAt(8.3)).toBe('collar');
    expect(materialAt(8.4)).toBe('led');
    expect(materialAt(8.9)).toBe('led');
    expect(materialAt(9.0)).toBe('body');
  });

  it('구간은 표본 전체를 빈틈없이 덮고 재질 경계에서만 끊는다', () => {
    expect(MATERIAL_SEGMENTS[0].i0).toBe(0);
    expect(MATERIAL_SEGMENTS[MATERIAL_SEGMENTS.length - 1].i1).toBe(SAMPLE_COUNT - 1);
    MATERIAL_SEGMENTS.forEach((sg, n) => {
      if (n > 0) {
        expect(sg.i0).toBe(MATERIAL_SEGMENTS[n - 1].i1);
        expect(sg.kind).not.toBe(MATERIAL_SEGMENTS[n - 1].kind);
      }
    });
    expect(MATERIAL_SEGMENTS.map((s) => s.kind)).toEqual(['body', 'collar', 'led', 'body']);
    const edges = MATERIAL_SEGMENTS.slice(1).map((s) => s.i0 * SAMPLE_STEP);
    expect(edges[0]).toBeCloseTo(3.6, 9);
    expect(edges[1]).toBeCloseTo(8.4, 9);
    expect(edges[2]).toBeCloseTo(9.0, 9);
  });
});

describe('표본', () => {
  it('간격 0.6, 표본별 반지름이 radiusAt과 같다', () => {
    expect(SAMPLE_STEP).toBe(0.6);
    expect(SAMPLE_RADII).toHaveLength(SAMPLE_COUNT);
    expect(SAMPLE_RADII[10]).toBeCloseTo(radiusAt(6), 9);
    expect((SAMPLE_COUNT - 1) * SAMPLE_STEP).toBeCloseTo(37.2, 6);
  });
});

describe('접촉 기하', () => {
  it('접촉 때 팁 중심 높이가 팁 반지름과 같다', () => {
    expect(FULCRUM_Y + Math.sin(CONTACT_PHI) * REACH).toBeCloseTo(TIP_R, 9);
  });
});

describe('shadeBand', () => {
  const key = norm([-0.3, 0.6, -0.7]);
  const fill = norm([0.7, 0.2, -0.6]);
  const view: Vec3 = [0, 0, -1];
  const base: Vec3 = [0.2, 0.64, 0.83];
  const lum = (c: Vec3) => c[0] + c[1] + c[2];

  it('주광을 정면으로 받는 띠가 등진 띠보다 밝다', () => {
    const rim = rimColor(base);
    const lit = shadeBand(base, key, view, key, fill, GLOSS_FINISH, rim);
    const away = shadeBand(base, [-key[0], -key[1], -key[2]], view, key, fill, GLOSS_FINISH, rim);
    expect(lum(lit)).toBeGreaterThan(lum(away));
  });

  it('센서 모듈 마감은 몸통보다 정반사가 약하다', () => {
    expect(COLLAR_FINISH.ks).toBeLessThan(GLOSS_FINISH.ks);
  });
});
