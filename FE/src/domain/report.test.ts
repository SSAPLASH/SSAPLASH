import { describe, expect, it } from 'vitest';
import { isTooShortForAnalysis, MIN_NOTES_FOR_ANALYSIS, segmentBars } from './report';

describe('segmentBars', () => {
  it('bpm 120·4박에서 7000~12000ms는 [3, 5]', () => {
    expect(segmentBars(7000, 12000, 120, 4)).toEqual([3, 5]);
  });

  it('bpm이 0이거나 박자가 0이면 null', () => {
    expect(segmentBars(7000, 12000, 0, 4)).toBeNull();
    expect(segmentBars(7000, 12000, 120, 0)).toBeNull();
    expect(segmentBars(7000, 12000, Number.NaN, 4)).toBeNull();
  });

  it('마디 경계는 feedback의 barOf와 같게 (t+1)로 센다', () => {
    expect(segmentBars(0, 1, 120, 4)).toEqual([0, 0]);
    expect(segmentBars(1999, 2000, 120, 4)).toEqual([1, 1]);
  });
});

describe('isTooShortForAnalysis', () => {
  it('판정 합 19는 짧고 20은 아니다', () => {
    expect(MIN_NOTES_FOR_ANALYSIS).toBe(20);
    expect(isTooShortForAnalysis({ PERFECT: 10, GOOD: 5, MISS: 4 })).toBe(true);
    expect(isTooShortForAnalysis({ PERFECT: 10, GOOD: 5, MISS: 5 })).toBe(false);
  });
});
