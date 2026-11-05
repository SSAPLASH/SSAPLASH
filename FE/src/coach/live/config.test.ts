import { describe, expect, it } from 'vitest';
import { COACH_BASIS, coachBasisMs, coachThresholds, LIVE_COACH_CONFIG, liveThresholds } from './config';

describe('liveThresholds', () => {
  it('ms 값이 goodMs에 비례한다 (30·60·150)', () => {
    for (const g of [30, 60, 150]) {
      const t = liveThresholds(g);
      expect(t.goodMs).toBe(g);
      expect(t.trendMeanMs).toBeCloseTo(LIVE_COACH_CONFIG.trend.meanCoef * g);
      expect(t.padDiffMs).toBeCloseTo(LIVE_COACH_CONFIG.pad.diffCoef * g);
      expect(t.unsteadyStdMs).toBeCloseTo(LIVE_COACH_CONFIG.unsteady.stdCoef * g);
    }
    // 판정 폭이 2.5배면 모든 ms 문턱이 2.5배다
    const a = liveThresholds(60);
    const b = liveThresholds(150);
    expect(b.trendMeanMs / a.trendMeanMs).toBeCloseTo(2.5);
    expect(b.padReleaseMs / a.padReleaseMs).toBeCloseTo(2.5);
    expect(b.unsteadyReleaseMs / a.unsteadyReleaseMs).toBeCloseTo(2.5);
  });

  it('goodMs = 60 기준 값이 설계 표와 같다', () => {
    const t = liveThresholds(60);
    expect(t.trendMeanMs).toBeCloseTo(18);
    expect(t.trendReleaseMs).toBeCloseTo(9);
    expect(t.padDiffMs).toBeCloseTo(27);
    expect(t.unsteadyStdMs).toBeCloseTo(30);
  });

  it('잘못된 goodMs는 기본 판정 폭으로 대체한다', () => {
    for (const g of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(liveThresholds(g).goodMs).toBe(60);
    }
  });

  it('거두는 문턱이 띄우는 문턱보다 낮다 (깜빡임 방지)', () => {
    const t = liveThresholds(60);
    expect(t.trendReleaseMs).toBeLessThan(t.trendMeanMs);
    expect(t.padReleaseMs).toBeLessThan(t.padDiffMs);
    expect(t.unsteadyReleaseMs).toBeLessThan(t.unsteadyStdMs);
    expect(LIVE_COACH_CONFIG.hand.releaseRatio).toBeGreaterThan(LIVE_COACH_CONFIG.hand.ratio);
  });
});

describe('코칭 기준 방식(coachBasisMs·coachThresholds)', () => {
  it('기본 방식은 fixed다', () => {
    expect(COACH_BASIS).toBe('fixed');
  });

  it('fixed: 사용자 goodMs가 60이면 이전 임계값과 같다', () => {
    expect(coachThresholds(60, 'fixed')).toEqual(liveThresholds(60));
    expect(coachThresholds(60)).toEqual(liveThresholds(60));
  });

  it('fixed: goodMs가 30·150이어도 60 기준과 같다', () => {
    for (const g of [30, 150]) expect(coachThresholds(g, 'fixed')).toEqual(liveThresholds(60));
  });

  it('window: goodMs에 비례한다(이전 동작과 같다)', () => {
    for (const g of [30, 60, 150]) {
      expect(coachBasisMs('window', g)).toBe(g);
      expect(coachThresholds(g, 'window')).toEqual(liveThresholds(g));
    }
  });
});
