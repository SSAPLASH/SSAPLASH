// 배치 → 판정 프로필 유도 검증: 중심·반경 변환, 이웃 상한, 킥 제외.
import { describe, expect, it } from 'vitest';
import { layoutToProfile } from './kitJudge';
import { DEFAULT_KIT_LAYOUT, type KitLayout } from './kitLayout';
import { DEFAULT_ANGLE_RANGE, screenRadiusToDeg, radiusToScreen } from './kitMapping';
import { STICK_PADS } from './pads';
import { DEFAULT_SENSOR_TUNING } from './tuning';

const OPTS = {
  maxRadiusDeg: DEFAULT_SENSOR_TUNING.maxRadiusDeg,
  radiusFactor: DEFAULT_SENSOR_TUNING.radiusFactor,
  createdAt: '2026-10-22T00:00:00.000Z',
};

describe('screenRadiusToDeg', () => {
  it('radiusToScreen의 역함수', () => {
    expect(radiusToScreen(screenRadiusToDeg(0.1))).toBeCloseTo(0.1);
    expect(screenRadiusToDeg(0.1, { yawDeg: 60, pitchDeg: 35 })).toBeCloseTo(12);
  });
});

describe('layoutToProfile', () => {
  it('화면 중앙(0.5, 0.5)은 pose (0, 0)', () => {
    const layout: KitLayout = { ...DEFAULT_KIT_LAYOUT, SNARE: { x: 0.5, y: 0.5, r: 0.05 } };
    const a = layoutToProfile(layout, DEFAULT_ANGLE_RANGE, OPTS).anchors.SNARE!;
    expect(a.pitch).toBeCloseTo(0);
    expect(a.yaw).toBeCloseTo(0);
  });

  it('기본 배치 SNARE(0.42, 0.68) 중심 변환', () => {
    const a = layoutToProfile(DEFAULT_KIT_LAYOUT, DEFAULT_ANGLE_RANGE, OPTS).anchors.SNARE!;
    expect(a.yaw).toBeCloseTo((0.42 - 0.5) * 120); // -9.6
    expect(a.pitch).toBeCloseTo(-(0.68 - 0.5) * 70); // -12.6
  });

  it('반경은 r을 각도로 환산한 값(이웃 상한이 더 크면)', () => {
    const layout: KitLayout = { ...DEFAULT_KIT_LAYOUT, SNARE: { x: 0.5, y: 0.5, r: 0.05 } };
    const a = layoutToProfile(layout, DEFAULT_ANGLE_RANGE, { ...OPTS, radiusFactor: 0.8 }).anchors.SNARE!;
    expect(a.radius).toBeCloseTo(screenRadiusToDeg(0.05)); // 6°
  });

  it('이웃 상한이 r보다 작으면 작은 쪽을 쓴다', () => {
    const layout: KitLayout = {
      ...DEFAULT_KIT_LAYOUT,
      SNARE: { x: 0.5, y: 0.5, r: 0.2 },
      SMALL_TOM: { x: 0.55, y: 0.5, r: 0.2 },
    };
    const p = layoutToProfile(layout, DEFAULT_ANGLE_RANGE, OPTS);
    const dist = 0.05 * 120; // 6°
    expect(p.anchors.SNARE!.radius).toBeLessThan(screenRadiusToDeg(0.2));
    expect(p.anchors.SNARE!.radius).toBeCloseTo(dist * OPTS.radiusFactor);
  });

  it('반경 상한(maxRadiusDeg)도 넘지 않는다', () => {
    const layout: KitLayout = { ...DEFAULT_KIT_LAYOUT, SNARE: { x: 0.42, y: 0.68, r: 0.4 } };
    const a = layoutToProfile(layout, DEFAULT_ANGLE_RANGE, { ...OPTS, maxRadiusDeg: 8 }).anchors.SNARE!;
    expect(a.radius).toBeLessThanOrEqual(8);
  });

  it('킥은 제외하고 스틱 패드만 담는다', () => {
    const p = layoutToProfile(DEFAULT_KIT_LAYOUT, DEFAULT_ANGLE_RANGE, OPTS);
    expect(p.anchors.KICK).toBeUndefined();
    expect(Object.keys(p.anchors).sort()).toEqual([...STICK_PADS].sort());
    expect(Object.keys(p.anchors)).toHaveLength(7);
  });

  it('pads를 주면 그 패드만 담는다', () => {
    const p = layoutToProfile(DEFAULT_KIT_LAYOUT, DEFAULT_ANGLE_RANGE, { ...OPTS, pads: ['SNARE', 'HIHAT'] });
    expect(Object.keys(p.anchors).sort()).toEqual(['HIHAT', 'SNARE']);
  });

  it('메타 필드: samples·spread 0, id·name·source', () => {
    const p = layoutToProfile(DEFAULT_KIT_LAYOUT, DEFAULT_ANGLE_RANGE, OPTS);
    expect(p).toMatchObject({ id: 'layout', name: '배치 기반', source: 'layout', audioOffsetMs: 0, createdAt: OPTS.createdAt });
    expect(p.anchors.SNARE).toMatchObject({ samples: 0, spread: 0 });
  });
});
