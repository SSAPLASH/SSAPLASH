import { describe, expect, it } from 'vitest';
import type { CalibrationProfile, PadAnchor } from '@/domain/kit/calibration/calibration';
import type { PadId } from '@/domain/kit/pads';
import type { DecodedHit } from '@/input/stickProtocol';
import { agreeRate, edgeDeg, edgeTone, hitPose, insideRate } from './boundary';
import type { LogRow } from './recording/packetLog';

const anchor = (pad: PadId, pitch: number, yaw: number, radius: number): PadAnchor => ({
  pad,
  pitch,
  yaw,
  radius,
  samples: 1,
  spread: 0,
});

const profile: CalibrationProfile = {
  id: 'p',
  name: 'p',
  createdAt: '',
  source: 'mock',
  anchors: {
    SNARE: anchor('SNARE', 0, 0, 10),
    CRASH: anchor('CRASH', 0, 40, 10),
  },
  maxRadiusDeg: 15,
  audioOffsetMs: 0,
} as CalibrationProfile;

const hit = (pad: PadId | null, elevationDeg: number, azimuthDeg: number): DecodedHit =>
  ({
    kind: 'hit',
    pad,
    elevationDeg,
    azimuthDeg,
    marginDeg: 0,
  }) as unknown as DecodedHit;

let id = 0;
const row = (decoded: DecodedHit): LogRow => ({ id: id++, t: id, dir: 'in', decoded, stick: 0 }) as unknown as LogRow;

describe('edgeDeg', () => {
  it('중심이면 edge = −radius', () => {
    const e = edgeDeg(profile, { pitch: 0, yaw: 0 });
    expect(e?.pad).toBe('SNARE');
    expect(e?.edgeDeg).toBe(-10);
    expect(e?.inside).toBe(true);
  });
  it('반경 경계는 0이고 안쪽(<=)', () => {
    const e = edgeDeg(profile, { pitch: 0, yaw: 10 });
    expect(e?.edgeDeg).toBeCloseTo(0, 6);
    expect(e?.inside).toBe(true);
  });
  it('바깥은 양수', () => {
    const e = edgeDeg(profile, { pitch: 0, yaw: 15 });
    expect(e?.edgeDeg).toBeCloseTo(5);
    expect(e?.inside).toBe(false);
  });
  it('프로필 없음·앵커 없음이면 null', () => {
    expect(edgeDeg(null, { pitch: 0, yaw: 0 })).toBeNull();
    expect(edgeDeg({ ...profile, anchors: {} }, { pitch: 0, yaw: 0 })).toBeNull();
  });
});

describe('hitPose', () => {
  it('고도 = pitch, 방위 = yaw', () => {
    expect(hitPose(hit('SNARE', 3, 4))).toEqual({ pitch: 3, yaw: 4 });
  });
});

describe('insideRate·agreeRate', () => {
  // 안쪽·일치 / 바깥·일치(SNARE 근처) / 안쪽·불일치(펌웨어는 SNARE라 했지만 CRASH 안)
  const rows = [row(hit('SNARE', 0, 0)), row(hit('SNARE', 0, 15)), row(hit('SNARE', 0, 40))];
  it('안쪽 비율', () => {
    expect(insideRate(rows, profile)).toBeCloseTo(2 / 3);
  });
  it('agree 비율(pad null 제외)', () => {
    expect(agreeRate(rows, profile)).toBeCloseTo(2 / 3);
    expect(agreeRate([...rows, row(hit(null, 0, 0))], profile)).toBeCloseTo(2 / 3);
  });
  it('n개로 제한하고 HIT가 없으면 null', () => {
    expect(insideRate(rows, profile, 1)).toBe(1);
    expect(insideRate([], profile)).toBeNull();
    expect(agreeRate(rows, null)).toBeNull();
  });
});

describe('edgeTone', () => {
  it('경계', () => {
    expect(edgeTone(-2)).toBe('near');
    expect(edgeTone(2)).toBe('near');
    expect(edgeTone(-2.1)).toBe('inside');
    expect(edgeTone(2.1)).toBe('outside');
  });
});
