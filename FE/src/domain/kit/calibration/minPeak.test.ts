// 유저별 최소 타격 세기 계산 검증(PLAY-004 ③, 설계 3-3)
import { describe, expect, it } from 'vitest';
import { minPeakFromSpeeds, sanitizeMinPeak } from './minPeak';

const rep = (v: number, n = 6) => Array.from({ length: n }, () => v);

describe('minPeakFromSpeeds', () => {
  it('중앙값 × 0.4: 800 → 320', () => {
    expect(minPeakFromSpeeds(rep(800))).toEqual({ dps: 320, medianDps: 800 });
  });
  it('하한 250: 500 → 250', () => {
    expect(minPeakFromSpeeds(rep(500))?.dps).toBe(250);
  });
  it('상한 400: 1200 → 400', () => {
    expect(minPeakFromSpeeds(rep(1200))?.dps).toBe(400);
  });
  it('표본 5개는 null, 6개는 계산', () => {
    expect(minPeakFromSpeeds(rep(800, 5))).toBeNull();
    expect(minPeakFromSpeeds(rep(800, 6))).not.toBeNull();
  });
  it('NaN·0·음수·Infinity는 표본에서 뺀다', () => {
    expect(minPeakFromSpeeds([...rep(800, 5), NaN, 0, -3, Infinity])).toBeNull();
    expect(minPeakFromSpeeds([...rep(800, 6), NaN, 0, -3])?.medianDps).toBe(800);
  });
  it('중앙값은 이상치에 강하다', () => {
    expect(minPeakFromSpeeds([700, 750, 800, 850, 900, 9000])?.medianDps).toBe(825);
  });
  it('반올림', () => {
    expect(minPeakFromSpeeds(rep(803))?.dps).toBe(321);
  });
});

describe('sanitizeMinPeak', () => {
  it('250~400 유한 수만 반올림해 돌려준다', () => {
    expect(sanitizeMinPeak(320)).toBe(320);
    expect(sanitizeMinPeak(320.6)).toBe(321);
    expect(sanitizeMinPeak(250)).toBe(250);
    expect(sanitizeMinPeak(400)).toBe(400);
  });
  it('범위 밖·NaN·문자열·null은 null', () => {
    for (const v of [249, 401, NaN, Infinity, '300', null, undefined, {}]) expect(sanitizeMinPeak(v)).toBeNull();
  });
});
