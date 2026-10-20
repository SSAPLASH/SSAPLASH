// 캘리브레이션 세션 상태 기계 검증 (설계 4-1 캡처 규칙). 가짜 자세와 가짜 시각만 쓴다.
import { describe, expect, it } from 'vitest';
import { CalibrationSession } from './CalibrationSession';
import { createEmptyProfile, computeBoundaries } from '@/domain/calibration';
import type { Pose } from '@/domain/events';
import type { PadId } from '@/domain/pads';

const PADS: PadId[] = ['CRASH', 'HIHAT', 'SNARE'];
const P = (pitch: number, yaw: number): Pose => ({ pitch, yaw });

/** t0부터 dt 간격으로 n개 자세를 넣는다 (홀딩 시뮬레이션) */
function feed(s: CalibrationSession, pose: Pose, t0: number, n: number, dt = 16): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    s.onPose(pose, t);
    t += dt;
  }
  return t;
}

describe('홀딩 모드', () => {
  it('안정 → 진행 바 → holdMs 지나면 자동 확정, 다음 패드로', () => {
    const s = new CalibrationSession(PADS, { mode: 'hold', holdMs: 1000 });
    expect(s.snapshot().current).toBe('CRASH');
    let t = feed(s, P(10, -20), 0, 5); // 5샘플부터 안정 판정
    expect(s.snapshot().phase).toBe('holding');
    t = feed(s, P(10, -20), t, 30); // 약 480ms
    expect(s.snapshot().progress).toBeGreaterThan(0.4);
    expect(s.snapshot().progress).toBeLessThan(0.7);
    feed(s, P(10, -20), t, 40); // 1000ms 넘김
    const snap = s.snapshot();
    expect(snap.index).toBe(1);
    expect(snap.current).toBe('HIHAT');
    expect(snap.anchors.CRASH).toMatchObject({ pad: 'CRASH', pitch: 10, yaw: -20 });
    expect(snap.anchors.HIHAT).toBeUndefined(); // 남은 샘플은 다음 패드 홀딩에 쓰인다
  });

  it('흔들리면 진행이 0으로 돌아간다', () => {
    const s = new CalibrationSession(PADS, { mode: 'hold', holdMs: 1000 });
    const t = feed(s, P(0, 0), 0, 30);
    expect(s.snapshot().progress).toBeGreaterThan(0.3);
    s.onPose(P(20, 20), t); // 최근 300ms 퍼짐이 커진다
    expect(s.snapshot().phase).toBe('aim');
    expect(s.snapshot().progress).toBe(0);
    expect(s.snapshot().anchors.CRASH).toBeUndefined();
  });

  it('자세 스트림이 300ms 넘게 끊겼다 돌아오면 홀딩을 처음부터 (팝업 중 공백이 진행에 더해지지 않는다)', () => {
    const s = new CalibrationSession(PADS, { mode: 'hold', holdMs: 1000 });
    const t = feed(s, P(0, 0), 0, 30); // 약 480ms 진행
    expect(s.snapshot().progress).toBeGreaterThan(0.3);
    s.onPose(P(0, 0), t + 5000); // 5초 공백 후 복귀
    expect(s.snapshot().anchors.CRASH).toBeUndefined();
    expect(s.snapshot().progress).toBe(0);
  });

  it('홀딩 중 타격은 지금까지 샘플 평균으로 즉시 확정', () => {
    const s = new CalibrationSession(PADS, { mode: 'hold', holdMs: 5000 });
    feed(s, P(10, 10), 0, 20);
    s.onHit(P(99, 99)); // 타격 자세는 무시, 홀딩 샘플 평균
    expect(s.snapshot().anchors.CRASH).toMatchObject({ pitch: 10, yaw: 10 });
    expect(s.snapshot().index).toBe(1);
  });

  it('안정 샘플이 3개 미만이면 타격 자세로 확정', () => {
    const s = new CalibrationSession(PADS, { mode: 'hold' });
    s.onHit(P(5, -5));
    expect(s.snapshot().anchors.CRASH).toMatchObject({ pitch: 5, yaw: -5, samples: 1 });
  });

  it('spread가 스냅샷에 실린다', () => {
    const s = new CalibrationSession(PADS, { mode: 'hold' });
    s.onPose(P(0, 0), 0);
    s.onPose(P(0, 4), 16);
    expect(s.snapshot().spread).toBeCloseTo(2);
  });
});

describe('2타 모드', () => {
  it('타격 2회 평균으로 확정, 진행은 1/2', () => {
    const s = new CalibrationSession(PADS, { mode: 'hits', hitsNeeded: 2 });
    s.onHit(P(0, 0));
    expect(s.snapshot().hitCount).toBe(1);
    expect(s.snapshot().progress).toBe(0.5);
    s.onHit(P(4, 2));
    expect(s.snapshot().anchors.CRASH).toMatchObject({ pitch: 2, yaw: 1, samples: 2 });
    expect(s.snapshot().hitCount).toBe(0);
  });

  it('자세 스트림은 확정에 영향 없다', () => {
    const s = new CalibrationSession(PADS, { mode: 'hits' });
    feed(s, P(0, 0), 0, 200);
    expect(s.snapshot().index).toBe(0);
  });
});

describe('skip · redo · restart', () => {
  function done3(): CalibrationSession {
    const s = new CalibrationSession(PADS, { mode: 'hits', hitsNeeded: 1 });
    s.onHit(P(20, -30));
    s.onHit(P(20, -10));
    s.onHit(P(-10, 0));
    expect(s.snapshot().finished).toBe(true);
    return s;
  }

  it('skip은 앵커 없이 다음 패드로, 끝까지 가면 finished', () => {
    const s = new CalibrationSession(PADS, { mode: 'hits', hitsNeeded: 1 });
    s.skip();
    s.onHit(P(1, 1));
    s.skip();
    const snap = s.snapshot();
    expect(snap.finished).toBe(true);
    expect(Object.keys(snap.anchors)).toEqual(['HIHAT']);
  });

  it('redo(pad)는 그 패드부터 순서대로 이어 간다 (Backspace)', () => {
    const s = new CalibrationSession(PADS, { mode: 'hits', hitsNeeded: 1 });
    s.onHit(P(0, 0));
    s.onHit(P(0, 20));
    s.redo('CRASH');
    expect(s.snapshot().current).toBe('CRASH');
    expect(s.snapshot().anchors.CRASH).toBeUndefined();
    expect(s.snapshot().anchors.HIHAT).toBeDefined();
    s.onHit(P(1, 1));
    expect(s.snapshot().current).toBe('HIHAT'); // 이어서 진행
    expect(s.snapshot().finished).toBe(false);
  });

  it('redo(pad, true)는 그 패드만 확정하고 바로 finished (확인 단계 다시)', () => {
    const s = done3();
    s.redo('HIHAT', true);
    expect(s.snapshot().current).toBe('HIHAT');
    expect(s.snapshot().finished).toBe(false);
    s.onHit(P(30, -12));
    const snap = s.snapshot();
    expect(snap.finished).toBe(true);
    expect(snap.anchors.HIHAT).toMatchObject({ pitch: 30, yaw: -12 });
    expect(snap.anchors.CRASH).toMatchObject({ pitch: 20, yaw: -30 });
    expect(snap.anchors.SNARE).toBeDefined();
  });

  it('redo(pad, true) 중 skip도 바로 finished', () => {
    const s = done3();
    s.redo('SNARE', true);
    s.skip();
    expect(s.snapshot().finished).toBe(true);
    expect(s.snapshot().anchors.SNARE).toBeUndefined();
  });

  it('restart는 앵커를 비우고 처음부터', () => {
    const s = done3();
    s.restart();
    const snap = s.snapshot();
    expect(snap.index).toBe(0);
    expect(snap.anchors).toEqual({});
    expect(snap.finished).toBe(false);
  });
});

describe('기존 프로필 · build', () => {
  it('기존 프로필을 안고 시작하면 앵커가 유지된다', () => {
    const p = createEmptyProfile('pointer');
    p.anchors = computeBoundaries({ CRASH: { pad: 'CRASH', pitch: 1, yaw: 2, radius: 0, samples: 3, spread: 0 } }, 22);
    const s = new CalibrationSession(PADS, { mode: 'hits', hitsNeeded: 1 }, p);
    expect(s.snapshot().anchors.CRASH).toMatchObject({ pitch: 1, yaw: 2 });
    s.redo('HIHAT', true);
    s.onHit(P(5, 5));
    expect(s.snapshot().anchors.CRASH).toBeDefined();
    expect(s.snapshot().anchors.HIHAT).toBeDefined();
  });

  it('확정마다 반경이 앵커 간 거리로 재계산되고 build가 그대로 담는다', () => {
    const s = new CalibrationSession(PADS, { mode: 'hits', hitsNeeded: 1, maxRadiusDeg: 22, source: 'pointer' });
    s.onHit(P(0, 0));
    expect(s.snapshot().anchors.CRASH!.radius).toBe(22); // 혼자면 상한
    s.onHit(P(0, 20));
    expect(s.snapshot().anchors.CRASH!.radius).toBeCloseTo(11); // 20 × 0.55
    s.onHit(P(0, 100));
    const prof = s.build('테스트');
    expect(prof.name).toBe('테스트');
    expect(prof.source).toBe('pointer');
    expect(prof.maxRadiusDeg).toBe(22);
    expect(prof.anchors.HIHAT!.radius).toBeCloseTo(11);
    expect(prof.anchors.SNARE!.radius).toBe(22); // 가장 가까운 앵커가 80° 밖 → 상한
    expect(prof.id).toMatch(/^cal-/);
  });
});

describe('radiusFactor 옵션', () => {
  it('미리보기와 build의 반경 계산에 계수가 쓰인다', () => {
    const s = new CalibrationSession(PADS, { mode: 'hits', hitsNeeded: 1, maxRadiusDeg: 40, radiusFactor: 0.8 });
    s.onHit(P(0, 0));
    s.onHit(P(0, 20));
    expect(s.snapshot().anchors.CRASH!.radius).toBeCloseTo(16); // 20 × 0.8
    expect(s.build().anchors.HIHAT!.radius).toBeCloseTo(16);
  });
});
