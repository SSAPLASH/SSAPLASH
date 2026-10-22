// 매퍼 계층(설계 D8) 검증. 소스 종류에 따라 키 매퍼 / 자세 매퍼가 골라지고,
// 각각 keyMap / 캘리브레이션 프로필만으로 패드를 정하는지 확인한다.
import { describe, expect, it } from 'vitest';
import { mapHit, mapHitByKey, mapHitByPose, mapperFor } from './padMapper';
import { KEY_MAP } from '@/domain/keyMap';
import { computeBoundaries, createEmptyProfile, type CalibrationProfile } from '@/domain/calibration';
import type { StickHitEvent } from '@/domain/events';

function hit(partial: Partial<StickHitEvent> = {}): StickHitEvent {
  return {
    kind: 'hit',
    stickId: 0,
    timestamp: 0,
    recvTime: 0,
    peakAccel: 6.3,
    pitch: 0,
    yaw: 0,
    ...partial,
  };
}

function profile2(): CalibrationProfile {
  const p = createEmptyProfile('pointer');
  p.anchors = computeBoundaries(
    {
      SNARE: { pad: 'SNARE', pitch: 0, yaw: -20, radius: 0, samples: 5, spread: 0 },
      HIHAT: { pad: 'HIHAT', pitch: 0, yaw: 20, radius: 0, samples: 5, spread: 0 },
    },
    22,
  );
  return p;
}

describe('mapperFor', () => {
  it('키보드만 키 매퍼, 나머지는 자세 매퍼', () => {
    expect(mapperFor('keyboard')).toBe('key');
    expect(mapperFor('pointer')).toBe('pose');
    expect(mapperFor('ble')).toBe('pose');
    expect(mapperFor('websocket')).toBe('pose');
  });
});

describe('mapHitByKey', () => {
  it('바인딩된 키 → 패드와 바인딩의 스틱', () => {
    expect(mapHitByKey(hit({ keyCode: 'KeyF' }), KEY_MAP)).toEqual({ pad: 'SNARE', stickId: 0 });
    expect(mapHitByKey(hit({ keyCode: 'KeyJ' }), KEY_MAP)).toEqual({ pad: 'SNARE', stickId: 1 });
    expect(mapHitByKey(hit({ keyCode: 'Space' }), KEY_MAP).pad).toBe('KICK');
  });

  it('바인딩 없는 키·키 코드 없음 → 패드 없음', () => {
    expect(mapHitByKey(hit({ keyCode: 'KeyZ' }), KEY_MAP)).toEqual({ pad: null });
    expect(mapHitByKey(hit(), KEY_MAP)).toEqual({ pad: null });
  });

  it('keyMap을 바꾸면 즉시 따라간다 (설정 재바인딩)', () => {
    const custom = { KeyZ: { pad: 'CRASH' as const, stickId: 1 as const } };
    expect(mapHitByKey(hit({ keyCode: 'KeyZ' }), custom)).toEqual({ pad: 'CRASH', stickId: 1 });
    expect(mapHitByKey(hit({ keyCode: 'KeyF' }), custom)).toEqual({ pad: null });
  });

  it('자세는 보지 않는다', () => {
    expect(mapHitByKey(hit({ keyCode: 'KeyF', pitch: 50, yaw: 50 }), KEY_MAP).pad).toBe('SNARE');
  });
});

describe('mapHitByPose', () => {
  it('프로필 없음 → 패드 없음', () => {
    expect(mapHitByPose(hit({ yaw: -20 }), null)).toEqual({ pad: null });
  });

  it('앵커 반경 안 → 패드 + 거리', () => {
    const r = mapHitByPose(hit({ pitch: 1, yaw: -19 }), profile2());
    expect(r.pad).toBe('SNARE');
    expect(r.distanceDeg).toBeCloseTo(Math.hypot(1, 1));
    expect(r.stickId).toBeUndefined();
  });

  it('반경 밖 → 패드 없음, 거리는 남긴다', () => {
    const r = mapHitByPose(hit({ pitch: 0, yaw: 0 }), profile2()); // 두 앵커 중간, 거리 20 > 반경 22? 아니 반경 = 40×0.55 = 22
    expect(r.pad).toBe('SNARE'); // 거리 20 ≤ 22 → 안
    const far = mapHitByPose(hit({ pitch: 30, yaw: 0 }), profile2()); // 거리 √(900+400) ≈ 36 > 22
    expect(far.pad).toBeNull();
    expect(far.distanceDeg).toBeCloseTo(Math.hypot(30, 20));
  });

  it('후보 제한이 있으면 반경 밖이어도 가장 가까운 후보', () => {
    const r = mapHitByPose(hit({ pitch: 30, yaw: 0 }), profile2(), ['HIHAT']);
    expect(r.pad).toBe('HIHAT');
  });

  it('키 코드는 보지 않는다', () => {
    const r = mapHitByPose(hit({ keyCode: 'KeyF', pitch: 1, yaw: 19 }), profile2());
    expect(r.pad).toBe('HIHAT');
  });
});

describe('mapHit (소스 종류로 매퍼 선택)', () => {
  const ctx = { keyMap: KEY_MAP, profile: profile2() };

  it('같은 이벤트라도 소스가 keyboard면 keyMap, 아니면 프로필로 정한다', () => {
    const e = hit({ keyCode: 'KeyF', pitch: 0, yaw: 20 }); // 키는 스네어, 자세는 하이햇
    expect(mapHit(e, 'keyboard', ctx).pad).toBe('SNARE');
    expect(mapHit(e, 'pointer', ctx).pad).toBe('HIHAT');
    expect(mapHit(e, 'ble', ctx).pad).toBe('HIHAT');
  });

  it('센서 소스에 프로필만 채우면 된다 — 키 매핑은 영향 없음', () => {
    const noKeys = { keyMap: {}, profile: profile2() };
    expect(mapHit(hit({ pitch: 0, yaw: -20 }), 'ble', noKeys).pad).toBe('SNARE');
  });
});

describe('mapHitByPose — 앵커 밖 정책', () => {
  const outside = hit({ pitch: 30, yaw: 0 }); // 두 앵커 모두 반경(22) 밖

  it("기본·'mute': 밖이면 패드 없음, inside=false", () => {
    const r = mapHitByPose(outside, profile2());
    expect(r.pad).toBeNull();
    expect(r.inside).toBe(false);
    expect(mapHitByPose(outside, profile2(), undefined, 'mute').pad).toBeNull();
  });

  it("'nearest': 밖이어도 가장 가까운 앵커 패드, inside는 false로 남는다", () => {
    const r = mapHitByPose(hit({ pitch: 30, yaw: 8 }), profile2(), undefined, 'nearest');
    expect(r.pad).toBe('HIHAT'); // yaw 8이 +20 앵커에 더 가깝다
    expect(r.inside).toBe(false);
    expect(r.distanceDeg).toBeGreaterThan(22);
  });

  it('반경 안이면 정책과 무관하게 같은 결과, inside=true', () => {
    const e = hit({ pitch: 1, yaw: -19 });
    expect(mapHitByPose(e, profile2(), undefined, 'mute')).toEqual(mapHitByPose(e, profile2(), undefined, 'nearest'));
    expect(mapHitByPose(e, profile2()).inside).toBe(true);
  });

  it('후보 제한이 있으면 정책과 무관하게 가장 가까운 후보', () => {
    expect(mapHitByPose(outside, profile2(), ['HIHAT'], 'mute').pad).toBe('HIHAT');
    expect(mapHitByPose(outside, profile2(), ['HIHAT'], 'nearest').pad).toBe('HIHAT');
  });

  it('mapHit이 ctx.outsidePolicy를 전달한다', () => {
    const ctx = { keyMap: KEY_MAP, profile: profile2() };
    expect(mapHit(outside, 'pointer', ctx).pad).toBeNull();
    expect(mapHit(outside, 'pointer', { ...ctx, outsidePolicy: 'nearest' }).pad).not.toBeNull();
  });

  it('키 매퍼에는 정책이 영향 없다', () => {
    const e = hit({ keyCode: 'KeyF' });
    expect(mapHit(e, 'keyboard', { keyMap: KEY_MAP, profile: null, outsidePolicy: 'nearest' }).pad).toBe('SNARE');
  });
});
