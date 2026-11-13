// 기준선 판정(PLAY-003·PLAY-004) 규칙 검증. 하드웨어 없이 가짜 자세 숫자로 규칙만 확인한다.
// 거리·평균은 방향 벡터(대원 각도)라 방위각 ±180° 경계에서 연속이어야 한다(설계 D3).
import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  clampRadius,
  computeBoundaries,
  createEmptyProfile,
  withRadiusOverride,
  meanPose,
  padGaps,
  pairSpread,
  poseDistance,
  poseToVec,
  resolvePad,
  summarizePoses,
  vecToPose,
  type CalibrationProfile,
  type PadAnchor,
} from './calibration';
import type { PadId } from '@/domain/kit/pads';

function anchor(pad: PadId, pitch: number, yaw: number, radius = 0): PadAnchor {
  return { pad, pitch, yaw, radius, samples: 10, spread: 0.5 };
}

/** 스네어 왼쪽 아래, 하이햇 왼쪽 위, 라이드 오른쪽 위 — 앵커 3개짜리 프로필(하한 8°로 이웃 거리가 그대로 드러나게) */
function profile3(): CalibrationProfile {
  const p = createEmptyProfile('pointer');
  p.anchors = computeBoundaries(
    {
      SNARE: anchor('SNARE', -10, -20),
      HIHAT: anchor('HIHAT', 15, -20),
      RIDE: anchor('RIDE', 15, 30),
    },
    p.maxRadiusDeg,
    0.55,
    8,
  );
  return p;
}

describe('poseToVec / vecToPose', () => {
  it('정면(0, 0)은 x축, 위 90°는 z축, 오른쪽 90°는 y축', () => {
    expect(poseToVec({ pitch: 0, yaw: 0 }).map((v) => +v.toFixed(6))).toEqual([1, 0, 0]);
    expect(poseToVec({ pitch: 90, yaw: 0 }).map((v) => +v.toFixed(6))).toEqual([0, 0, 1]);
    expect(poseToVec({ pitch: 0, yaw: 90 }).map((v) => +v.toFixed(6))).toEqual([0, 1, 0]);
  });

  it('왕복 변환이 원래 자세로 돌아온다(방위각 ±180° 안)', () => {
    for (const p of [
      { pitch: 12, yaw: -170 },
      { pitch: -40, yaw: 35 },
      { pitch: 60, yaw: 179 },
    ]) {
      const back = vecToPose(poseToVec(p));
      expect(back.pitch).toBeCloseTo(p.pitch, 6);
      expect(back.yaw).toBeCloseTo(p.yaw, 6);
    }
  });

  it('영벡터는 (0, 0)', () => {
    expect(vecToPose([0, 0, 0])).toEqual({ pitch: 0, yaw: 0 });
  });
});

describe('angleBetween / poseDistance', () => {
  it('같은 자세는 0, 방위각만 10° 차이면 10°(고도 0)', () => {
    expect(angleBetween({ pitch: 0, yaw: 0 }, { pitch: 0, yaw: 0 })).toBeCloseTo(0);
    expect(angleBetween({ pitch: 0, yaw: -5 }, { pitch: 0, yaw: 5 })).toBeCloseTo(10);
  });

  it('고도가 높을수록 같은 방위각 차의 실제 각도는 작다(유클리드가 아니다)', () => {
    const low = angleBetween({ pitch: 0, yaw: 0 }, { pitch: 0, yaw: 20 });
    const high = angleBetween({ pitch: 60, yaw: 0 }, { pitch: 60, yaw: 20 });
    expect(low).toBeCloseTo(20);
    expect(high).toBeLessThan(11);
  });

  it('방위각 ±180° 경계에서 연속이다: 179°와 −179°는 2° 차이', () => {
    expect(angleBetween({ pitch: 0, yaw: 179 }, { pitch: 0, yaw: -179 })).toBeCloseTo(2);
    expect(poseDistance({ pitch: 10, yaw: 178 }, { pitch: 10, yaw: -178 })).toBeLessThan(5);
  });

  it('poseDistance는 angleBetween과 같다', () => {
    const a = { pitch: 3, yaw: -4 };
    const b = { pitch: -7, yaw: 11 };
    expect(poseDistance(a, b)).toBe(angleBetween(a, b));
  });
});

describe('meanPose / pairSpread / summarizePoses', () => {
  it('대칭인 두 자세의 평균은 가운데', () => {
    const m = meanPose([
      { pitch: 10, yaw: -20 },
      { pitch: 14, yaw: -20 },
    ]);
    expect(m.pitch).toBeCloseTo(12);
    expect(m.yaw).toBeCloseTo(-20);
  });

  it('±180° 경계를 가로지르는 평균은 180° 근처(0이 아니다)', () => {
    const m = meanPose([
      { pitch: 0, yaw: 170 },
      { pitch: 0, yaw: -170 },
    ]);
    expect(Math.abs(m.yaw)).toBeCloseTo(180);
  });

  it('빈 배열은 (0, 0)', () => {
    expect(meanPose([])).toEqual({ pitch: 0, yaw: 0 });
  });

  it('pairSpread는 두 타격의 각도', () => {
    expect(pairSpread({ pitch: 0, yaw: 0 }, { pitch: 0, yaw: 8 })).toBeCloseTo(8);
  });

  it('summarizePoses: 평균과 RMS 퍼짐', () => {
    const r = summarizePoses([
      { pitch: 10, yaw: 0 },
      { pitch: 14, yaw: 0 },
    ]);
    expect(r.mean.pitch).toBeCloseTo(12);
    expect(r.spread).toBeCloseTo(2);
    expect(summarizePoses([])).toEqual({ mean: { pitch: 0, yaw: 0 }, spread: 0 });
  });
});

describe('computeBoundaries', () => {
  it('반경 = 가장 가까운 다른 앵커까지 각도 × 계수(기본 0.6), 하한 15°·상한에 자른다', () => {
    const out = computeBoundaries({ SNARE: anchor('SNARE', 0, -20), HIHAT: anchor('HIHAT', 0, 20) }, 35);
    // 각도 40 × 0.6 = 24
    expect(out.SNARE?.radius).toBeCloseTo(24);
    expect(out.HIHAT?.radius).toBeCloseTo(24);
  });

  it('가까운 앵커가 있으면 반경이 줄되 하한(15°) 아래로는 내려가지 않는다', () => {
    const out = computeBoundaries(
      { SNARE: anchor('SNARE', 0, 0), HIHAT: anchor('HIHAT', 0, 20), RIDE: anchor('RIDE', 0, 80) },
      35,
    );
    expect(out.SNARE?.radius).toBeCloseTo(15); // 20 × 0.6 = 12 → 하한 15
    expect(out.HIHAT?.radius).toBeCloseTo(15);
    expect(out.RIDE?.radius).toBeCloseTo(35); // 60 × 0.6 = 36 → 상한 35
  });

  it('하한을 직접 주면 그 값을 쓴다', () => {
    const out = computeBoundaries({ SNARE: anchor('SNARE', 0, 0), HIHAT: anchor('HIHAT', 0, 20) }, 35, 0.5, 8);
    expect(out.SNARE?.radius).toBeCloseTo(10);
  });

  it('앵커 하나뿐이면 상한', () => {
    const out = computeBoundaries({ KICK: anchor('KICK', 0, 0) }, 18);
    expect(out.KICK?.radius).toBe(18);
  });

  it('상한이 하한보다 작으면 상한이 이긴다', () => {
    const out = computeBoundaries({ SNARE: anchor('SNARE', 0, -50), HIHAT: anchor('HIHAT', 0, 50) }, 10, 0.6, 15);
    expect(out.SNARE?.radius).toBe(10);
  });

  it('방위각 ±180° 경계에 걸친 이웃도 가까운 것으로 본다', () => {
    const out = computeBoundaries({ SNARE: anchor('SNARE', 0, 175), HIHAT: anchor('HIHAT', 0, -175) }, 35, 0.6, 1);
    expect(out.SNARE?.radius).toBeCloseTo(6); // 10° × 0.6
  });

  it('radiusOverride가 있으면 자동값 대신 그 값을 하한·상한으로 잘라 쓴다(UX-64 D9)', () => {
    const out = computeBoundaries(
      { SNARE: { ...anchor('SNARE', 0, -20), radiusOverride: 30 }, HIHAT: { ...anchor('HIHAT', 0, 20), radiusOverride: 99 } },
      35,
    );
    expect(out.SNARE?.radius).toBe(30);
    expect(out.HIHAT?.radius).toBe(35);
    expect(out.SNARE?.radiusOverride).toBe(30);
  });
});

describe('padGaps', () => {
  const a = (pad: PadId, pitch: number, yaw: number) => ({ pad, pitch, yaw, radius: 18, samples: 2, spread: 1 });

  it('기준 미만 쌍만 쌍마다 1번, 가까운 순으로 돌려준다', () => {
    const set = { HIHAT: a('HIHAT', 0, 0), CRASH: a('CRASH', 0, 10), SNARE: a('SNARE', 0, 18), RIDE: a('RIDE', 0, 90) };
    const gaps = padGaps(set, 20);
    expect(gaps.map((g) => [g.a, g.b])).toEqual([
      ['CRASH', 'SNARE'],
      ['HIHAT', 'CRASH'],
      ['HIHAT', 'SNARE'],
    ]);
    expect(gaps[0].deg).toBeCloseTo(8, 5);
    expect(gaps[1].deg).toBeCloseTo(10, 5);
  });

  it('정확히 기준이면 포함하지 않고, 패드가 1개 이하·기준 아래 쌍이 없으면 빈 목록', () => {
    const [p, q] = [a('HIHAT', 0, 0), a('CRASH', 0, 20)];
    expect(padGaps({ HIHAT: p, CRASH: q }, angleBetween(p, q))).toEqual([]);
    expect(padGaps({ HIHAT: a('HIHAT', 0, 0) }, 20)).toEqual([]);
    expect(padGaps({}, 20)).toEqual([]);
  });
});

describe('withRadiusOverride', () => {
  it('그 패드 앵커의 radius·radiusOverride를 잘라 넣고 다른 패드는 그대로. 앵커가 없으면 입력 그대로', () => {
    const set = { SNARE: anchor('SNARE', 0, 0, 20), HIHAT: anchor('HIHAT', 0, 30, 20) };
    const out = withRadiusOverride(set, 'SNARE', 10, 15, 35)!;
    expect(out.SNARE).toMatchObject({ radius: 15, radiusOverride: 15 });
    expect(out.HIHAT).toBe(set.HIHAT);
    expect(withRadiusOverride(set, 'RIDE', 20, 15, 35)).toBe(set);
    expect(withRadiusOverride(null, 'SNARE', 20, 15, 35)).toBeNull();
    expect(clampRadius(50, 15, 35)).toBe(35);
  });
});

describe('resolvePad', () => {
  it('프로필이 없으면 null', () => {
    expect(resolvePad(null, { pitch: 0, yaw: 0 })).toBeNull();
  });

  it('가장 가까운 앵커를 고르고 반경 안이면 inside', () => {
    const r = resolvePad(profile3(), { pitch: -8, yaw: -18 });
    expect(r?.pad).toBe('SNARE');
    expect(r?.inside).toBe(true);
    expect(r?.distanceDeg).toBeCloseTo(angleBetween({ pitch: -8, yaw: -18 }, { pitch: -10, yaw: -20 }));
  });

  it('인접 앵커 중간 지점은 반경(0.55배) 안 — 영역이 살짝 겹쳐 빈틈이 없다', () => {
    // 스네어(-10,-20)와 하이햇(15,-20) 사이 각도 25 → 반경 13.75 > 12.5(중간)
    const r = resolvePad(profile3(), { pitch: 2.5, yaw: -20 });
    expect(r?.inside).toBe(true);
    expect(['SNARE', 'HIHAT']).toContain(r?.pad);
  });

  it('반경 밖이면 가장 가깝지만 inside=false', () => {
    const r = resolvePad(profile3(), { pitch: -5, yaw: -45 });
    expect(r?.pad).toBe('SNARE');
    expect(r?.inside).toBe(false);
  });

  it('후보 제한: 후보 밖 앵커는 아무리 가까워도 무시', () => {
    const r = resolvePad(profile3(), { pitch: -10, yaw: -20 }, ['RIDE']);
    expect(r?.pad).toBe('RIDE');
    expect(r?.inside).toBe(false);
  });

  it('후보에 앵커가 하나도 없으면 null', () => {
    expect(resolvePad(profile3(), { pitch: 0, yaw: 0 }, ['KICK'])).toBeNull();
  });

  it('±180° 경계 너머의 자세도 가까운 앵커로 판정한다', () => {
    const p = createEmptyProfile('ble');
    p.anchors = computeBoundaries({ RIDE: anchor('RIDE', 0, 178), SNARE: anchor('SNARE', 0, 0) }, 35);
    const r = resolvePad(p, { pitch: 0, yaw: -178 });
    expect(r?.pad).toBe('RIDE');
    expect(r?.inside).toBe(true);
  });
});
