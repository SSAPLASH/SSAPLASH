// 기준선 판정(PLAY-003) 규칙 검증. 하드웨어 없이 가짜 자세 숫자로 규칙만 확인한다.
// 상수(0.55, 상한 22°)의 적정성은 하드웨어 실측(미결 U6) 몫이다.
import { describe, expect, it } from 'vitest';
import {
  computeBoundaries,
  createEmptyProfile,
  isProfileComplete,
  poseDistance,
  resolvePad,
  summarizePoses,
  type CalibrationProfile,
  type PadAnchor,
} from './calibration';
import type { PadId } from './pads';

function anchor(pad: PadId, pitch: number, yaw: number, radius = 0): PadAnchor {
  return { pad, pitch, yaw, radius, samples: 10, spread: 0.5 };
}

/** 스네어 왼쪽 아래, 하이햇 왼쪽 위, 라이드 오른쪽 위 — 앵커 3개짜리 프로필 */
function profile3(): CalibrationProfile {
  const p = createEmptyProfile('pointer');
  p.anchors = computeBoundaries(
    {
      SNARE: anchor('SNARE', -10, -20),
      HIHAT: anchor('HIHAT', 15, -20),
      RIDE: anchor('RIDE', 15, 30),
    },
    p.maxRadiusDeg,
  );
  return p;
}

describe('poseDistance / summarizePoses', () => {
  it('각도 공간 유클리드 거리', () => {
    expect(poseDistance({ pitch: 0, yaw: 0 }, { pitch: 3, yaw: 4 })).toBe(5);
  });

  it('샘플 평균과 퍼짐', () => {
    const r = summarizePoses([
      { pitch: 10, yaw: 0 },
      { pitch: 14, yaw: 0 },
    ]);
    expect(r.mean).toEqual({ pitch: 12, yaw: 0 });
    expect(r.spread).toBe(2);
  });

  it('빈 샘플은 0', () => {
    expect(summarizePoses([])).toEqual({ mean: { pitch: 0, yaw: 0 }, spread: 0 });
  });
});

describe('computeBoundaries', () => {
  it('반경 = 가장 가까운 다른 앵커 거리 × 0.55', () => {
    const out = computeBoundaries(
      { SNARE: anchor('SNARE', 0, -20), HIHAT: anchor('HIHAT', 0, 20) },
      22,
    );
    // 거리 40 → 22 (0.55 × 40 = 22, 상한과 같음)
    expect(out.SNARE?.radius).toBeCloseTo(22);
    expect(out.HIHAT?.radius).toBeCloseTo(22);
  });

  it('가까운 앵커가 있으면 반경이 줄어든다', () => {
    const out = computeBoundaries(
      { SNARE: anchor('SNARE', 0, 0), HIHAT: anchor('HIHAT', 0, 20), RIDE: anchor('RIDE', 0, 60) },
      22,
    );
    expect(out.SNARE?.radius).toBeCloseTo(11); // 20 × 0.55
    expect(out.HIHAT?.radius).toBeCloseTo(11); // 가까운 쪽(스네어) 기준
    expect(out.RIDE?.radius).toBeCloseTo(22); // 40 × 0.55 = 22 → 상한
  });

  it('앵커 하나뿐이면 상한', () => {
    const out = computeBoundaries({ KICK: anchor('KICK', 0, 0) }, 18);
    expect(out.KICK?.radius).toBe(18);
  });

  it('상한을 넘지 않는다', () => {
    const out = computeBoundaries(
      { SNARE: anchor('SNARE', 0, -50), HIHAT: anchor('HIHAT', 0, 50) },
      22,
    );
    expect(out.SNARE?.radius).toBe(22);
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
    expect(r?.distanceDeg).toBeCloseTo(Math.hypot(2, 2));
  });

  it('인접 앵커 중간 지점은 반경(0.55배) 안 — 영역이 살짝 겹쳐 빈틈이 없다', () => {
    // 스네어(-10,-20)와 하이햇(15,-20) 사이 거리 25 → 반경 13.75 > 12.5(중간)
    const r = resolvePad(profile3(), { pitch: 2.5, yaw: -20 });
    expect(r?.inside).toBe(true);
    expect(['SNARE', 'HIHAT']).toContain(r?.pad);
  });

  it('반경 밖이면 가장 가깝지만 inside=false', () => {
    // 스네어에서 (12.5, 20) 떨어진 곳: 거리 ≈ 23.6 > 13.75
    const r = resolvePad(profile3(), { pitch: 2.5, yaw: -40 });
    expect(r?.pad).toBe('SNARE');
    expect(r?.inside).toBe(false);
  });

  it('후보 제한: 후보 밖 앵커는 아무리 가까워도 무시', () => {
    // 스네어 중심을 쳤지만 후보가 라이드뿐이면 라이드
    const r = resolvePad(profile3(), { pitch: -10, yaw: -20 }, ['RIDE']);
    expect(r?.pad).toBe('RIDE');
    expect(r?.inside).toBe(false);
  });

  it('후보에 앵커가 하나도 없으면 null', () => {
    expect(resolvePad(profile3(), { pitch: 0, yaw: 0 }, ['KICK'])).toBeNull();
  });
});

describe('isProfileComplete', () => {
  it('요구한 패드가 모두 있어야 완료', () => {
    const p = profile3();
    expect(isProfileComplete(p, ['SNARE', 'HIHAT'])).toBe(true);
    expect(isProfileComplete(p, ['SNARE', 'KICK'])).toBe(false);
    expect(isProfileComplete(null, ['SNARE'])).toBe(false);
  });
});
