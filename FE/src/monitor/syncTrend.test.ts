import { describe, expect, it } from 'vitest';
import { LossHistory, median, slopeMsPerMin, spearman } from './syncTrend';

describe('median', () => {
  it('홀수·짝수·빈 배열', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('slopeMsPerMin', () => {
  it('1초마다 +0.02ms면 1.2ms/분', () => {
    const s = Array.from({ length: 10 }, (_, i) => ({ t: 1e6 + i * 1000, offsetObsMs: 5 + i * 0.02 }));
    expect(slopeMsPerMin(s)).toBeCloseTo(1.2, 6);
  });
  it('평평하면 0, 음수 기울기도 부호 유지', () => {
    expect(slopeMsPerMin([{ t: 0, offsetObsMs: 3 }, { t: 60_000, offsetObsMs: 3 }])).toBe(0);
    expect(slopeMsPerMin([{ t: 0, offsetObsMs: 3 }, { t: 60_000, offsetObsMs: 1 }])).toBeCloseTo(-2, 9);
  });
  it('표본 1개·시각 동일이면 null', () => {
    expect(slopeMsPerMin([{ t: 0, offsetObsMs: 1 }])).toBeNull();
    expect(slopeMsPerMin([{ t: 5, offsetObsMs: 1 }, { t: 5, offsetObsMs: 2 }])).toBeNull();
  });
});

describe('spearman', () => {
  it('단조 증가는 1, 단조 감소는 -1(비선형이어도)', () => {
    expect(spearman([1, 2, 3, 4], [1, 8, 27, 1000])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3, 4], [9, 5, 2, 1])).toBeCloseTo(-1, 9);
  });
  it('동순위는 평균 순위로 처리한다', () => {
    const r = spearman([1, 2, 2, 3], [1, 2, 3, 4]);
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThan(0.9);
    expect(r as number).toBeLessThan(1);
  });
  it('표본 부족·상수열은 null', () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('LossHistory', () => {
  it('1초 안의 push는 버리고 since로 창을 자른다', () => {
    const h = new LossHistory();
    h.push(0, [1, null]);
    h.push(500, [2, null]);
    h.push(1000, [3, 4]);
    h.push(2500, [0, 0]);
    expect(h.since(0).map((p) => p.t)).toEqual([0, 1000, 2500]);
    expect(h.since(1000).map((p) => p.pct[0])).toEqual([3, 0]);
    h.clear();
    expect(h.since(0)).toEqual([]);
  });
  it('keep 개수를 넘으면 오래된 것부터 버린다', () => {
    const h = new LossHistory(3);
    for (let i = 0; i < 5; i++) h.push(i * 1000, [i, null]);
    expect(h.since(0).map((p) => p.t)).toEqual([2000, 3000, 4000]);
  });
});
