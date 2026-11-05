import { describe, expect, it } from 'vitest';
import { hitMatch } from './hitMatch';

const W = { perfectMs: 25, goodMs: 60 };
const c = (...times: number[]) => times.map((timeMs, index) => ({ index, timeMs }));

describe('hitMatch', () => {
  it('후보가 없으면 채보 밖', () => {
    expect(hitMatch([], 0, W)).toEqual({ pick: null, contested: false, rule: null });
  });
  it('후보 하나는 경합 아님', () => {
    expect(hitMatch(c(1000), 1010, W)).toEqual({ pick: 0, contested: false, rule: 'earliest' });
  });
  it('기본은 가장 이른 노트', () => {
    expect(hitMatch(c(1000, 1100), 1055, W)).toEqual({ pick: 0, contested: true, rule: 'earliest' });
  });
  it('이른 노트가 PERFECT 안이면 예외 없음', () => {
    expect(hitMatch(c(1000, 1040), 1020, W).pick).toBe(0);
  });
  it('뒤 노트 PERFECT 안, 이른 노트 밖이면 예외', () => {
    expect(hitMatch(c(1000, 1050), 1060, W)).toEqual({ pick: 1, contested: true, rule: 'perfect-exception' });
  });
  it('예외 후보가 여럿이면 가장 가까운 것', () => {
    expect(hitMatch(c(1000, 1040, 1060), 1058, { perfectMs: 25, goodMs: 80 }).pick).toBe(2);
  });
  it('뒤 노트가 PERFECT 밖이면 이른 노트', () => {
    expect(hitMatch(c(1000, 1050), 1080, W).pick).toBe(0);
  });
});
