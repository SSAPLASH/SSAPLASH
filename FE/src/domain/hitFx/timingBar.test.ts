import { describe, expect, it } from 'vitest';
import { addTimingMark, EMPTY_TIMING_BAR, hasLiveTicks, TIMING_BAR_FADE_MS, TIMING_BAR_MAX, timingBarView, type TimingBarState } from './timingBar';

const add = (s: TimingBarState, deltaMs: number, at: number, judgement: 'PERFECT' | 'GOOD' = 'GOOD') => addTimingMark(s, { deltaMs, judgement, at });

describe('timingBar', () => {
  it('빈 상태: 눈금·평균 없음', () => {
    const v = timingBarView(EMPTY_TIMING_BAR, 0, 60);
    expect(v.ticks).toEqual([]);
    expect(v.avgPos).toBeNull();
    expect(hasLiveTicks(EMPTY_TIMING_BAR, 0)).toBe(false);
  });

  it('PERFECT·GOOD만 쌓고 MISS·deltaMs 없음은 무시(같은 상태 객체)', () => {
    const s = add(EMPTY_TIMING_BAR, 10, 0, 'PERFECT');
    expect(addTimingMark(s, { deltaMs: null, judgement: 'MISS', at: 5 })).toBe(s);
    expect(addTimingMark(s, { deltaMs: 5, judgement: 'MISS', at: 5 })).toBe(s);
    expect(addTimingMark(s, { deltaMs: null, judgement: 'GOOD', at: 5 })).toBe(s);
    expect(addTimingMark(s, { deltaMs: 5, judgement: null, at: 5 })).toBe(s);
    expect(s.marks).toHaveLength(1);
  });

  it('위치는 deltaMs/goodMs: 빠름 음수, 늦음 양수, 창 밖은 ±1로 붙는다', () => {
    let s = add(EMPTY_TIMING_BAR, -30, 0);
    s = add(s, 60, 0);
    s = add(s, 0, 0, 'PERFECT');
    s = add(s, 200, 0);
    const pos = timingBarView(s, 0, 60).ticks.map((t) => t.pos);
    expect(pos).toEqual([-0.5, 1, 0, 1]);
  });

  it('최대 20개 — 넘으면 오래된 것부터 버린다', () => {
    let s = EMPTY_TIMING_BAR;
    for (let i = 0; i < 25; i++) s = add(s, i, i);
    expect(s.marks).toHaveLength(TIMING_BAR_MAX);
    expect(s.marks[0]!.deltaMs).toBe(5);
    expect(s.marks[19]!.deltaMs).toBe(24);
  });

  it('2초에 걸쳐 옅어지고 사라진다', () => {
    const s = add(EMPTY_TIMING_BAR, 10, 1000);
    expect(timingBarView(s, 1000, 60).ticks[0]!.alpha).toBeCloseTo(1);
    expect(timingBarView(s, 2000, 60).ticks[0]!.alpha).toBeCloseTo(0.5);
    expect(timingBarView(s, 1000 + TIMING_BAR_FADE_MS, 60).ticks).toEqual([]);
    expect(hasLiveTicks(s, 2999)).toBe(true);
    expect(hasLiveTicks(s, 3000)).toBe(false);
  });

  it('평균은 최근 10타(옅어진 눈금 포함)', () => {
    let s = EMPTY_TIMING_BAR;
    for (let i = 0; i < 10; i++) s = add(s, -60, i); // 오래된 10타: 매우 빠름
    for (let i = 0; i < 10; i++) s = add(s, 30, 100 + i); // 최근 10타: +30
    expect(timingBarView(s, 100000, 60).avgPos).toBeCloseTo(0.5);
    expect(timingBarView(s, 100000, 60).ticks).toEqual([]); // 눈금은 모두 옅어졌어도 평균은 남는다
  });

  it('타격이 10개 미만이면 있는 만큼 평균', () => {
    let s = add(EMPTY_TIMING_BAR, -20, 0);
    s = add(s, -40, 1);
    expect(timingBarView(s, 1, 60).avgPos).toBeCloseTo(-0.5);
  });

  it('입력 상태를 바꾸지 않는다(불변)', () => {
    const s = add(EMPTY_TIMING_BAR, 1, 0);
    const before = s.marks.length;
    add(s, 2, 1);
    expect(s.marks).toHaveLength(before);
  });
});
