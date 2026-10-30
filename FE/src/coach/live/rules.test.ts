import { describe, expect, it } from 'vitest';
import { liveThresholds } from './config';
import { evaluateRules, type RuleEvaluation } from './rules';
import type { HandStat, WindowMetrics } from './window';

function metrics(over: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    total: 12,
    validCount: 12,
    meanDelta: 0,
    sameSignRatio: 0.5,
    stdDelta: 5,
    missInRecent: 0,
    trailingMisses: 0,
    missInRelease: 0,
    pads: [],
    hands: [
      { count: 0, meanVelocity: 0 },
      { count: 0, meanVelocity: 0 },
    ],
    ...over,
  };
}

const th = liveThresholds(60); // 늦음 18ms, 해제 9ms, 패드 차이 27ms·해제 15ms, 편차 30ms·해제 21ms
const find = (list: RuleEvaluation[], key: string): RuleEvaluation => {
  const e = list.find((x) => x.key === key);
  if (!e) throw new Error(`규칙 ${key}가 없다`);
  return e;
};
const hands = (a: HandStat, b: HandStat): WindowMetrics['hands'] => [a, b];

describe('LIVE_LATE / LIVE_EARLY', () => {
  it('평균 +25ms, 같은 부호 90%면 LIVE_LATE만 뜬다', () => {
    const r = evaluateRules(metrics({ meanDelta: 25, sameSignRatio: 0.9 }), th);
    expect(find(r, 'LIVE_LATE').trigger).toBe(true);
    expect(find(r, 'LIVE_EARLY').trigger).toBe(false);
    expect(find(r, 'LIVE_LATE').severity).toBeCloseTo(25 / 72);
  });

  it('평균 -25ms면 LIVE_EARLY만 뜬다', () => {
    const r = evaluateRules(metrics({ meanDelta: -25, sameSignRatio: 0.9 }), th);
    expect(find(r, 'LIVE_EARLY').trigger).toBe(true);
    expect(find(r, 'LIVE_LATE').trigger).toBe(false);
  });

  it('같은 부호 비율이 75% 미만이거나 표본이 8개 미만이면 뜨지 않는다', () => {
    expect(find(evaluateRules(metrics({ meanDelta: 25, sameSignRatio: 0.7 }), th), 'LIVE_LATE').trigger).toBe(false);
    expect(find(evaluateRules(metrics({ meanDelta: 25, sameSignRatio: 0.9, validCount: 7 }), th), 'LIVE_LATE').trigger).toBe(false);
  });

  it('평균이 18ms 미만이면 뜨지 않는다', () => {
    expect(find(evaluateRules(metrics({ meanDelta: 17, sameSignRatio: 1 }), th), 'LIVE_LATE').trigger).toBe(false);
  });

  it('거두는 조건: 늦음은 평균이 +9ms 이하, 빠름은 -9ms 이상', () => {
    expect(find(evaluateRules(metrics({ meanDelta: 8 }), th), 'LIVE_LATE').release).toBe(true);
    expect(find(evaluateRules(metrics({ meanDelta: 10 }), th), 'LIVE_LATE').release).toBe(false);
    expect(find(evaluateRules(metrics({ meanDelta: -8 }), th), 'LIVE_EARLY').release).toBe(true);
    expect(find(evaluateRules(metrics({ meanDelta: -10 }), th), 'LIVE_EARLY').release).toBe(false);
    // 방향이 뒤집히면 늦음은 거둔다
    expect(find(evaluateRules(metrics({ meanDelta: -30 }), th), 'LIVE_LATE').release).toBe(true);
  });

  it('계산할 수 없으면(평균 null) 거두지 않는다', () => {
    const r = evaluateRules(metrics({ meanDelta: null, validCount: 0, sameSignRatio: null, stdDelta: null }), th);
    expect(find(r, 'LIVE_LATE').release).toBe(false);
    expect(find(r, 'LIVE_EARLY').release).toBe(false);
  });

  it('goodMs에 비례한다: 150이면 +25ms는 뜨지 않고, 30이면 +10ms도 뜬다', () => {
    const wide = evaluateRules(metrics({ meanDelta: 25, sameSignRatio: 1 }), liveThresholds(150));
    expect(find(wide, 'LIVE_LATE').trigger).toBe(false);
    const narrow = evaluateRules(metrics({ meanDelta: 10, sameSignRatio: 1 }), liveThresholds(30));
    expect(find(narrow, 'LIVE_LATE').trigger).toBe(true);
  });
});

describe('LIVE_PAD_LATE / LIVE_PAD_EARLY', () => {
  it('한 패드만 전체보다 27ms 이상 늦으면 그 패드 키로 뜬다', () => {
    const r = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 4, meanDelta: 40 }] }), th);
    const e = find(r, 'LIVE_PAD_LATE:SNARE');
    expect(e.trigger).toBe(true);
    expect(e.tag).toBe('LIVE_PAD_LATE');
    expect(e.text).toBe('스네어에서 유독 늦어요.');
    expect(find(r, 'LIVE_PAD_LATE:HIHAT').trigger).toBe(false);
    expect(find(r, 'LIVE_PAD_EARLY:SNARE').trigger).toBe(false);
  });

  it('차이가 27ms 미만이면 뜨지 않는다', () => {
    const r = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 5, meanDelta: 30 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').trigger).toBe(false);
  });

  it('그 패드 표본이 4개 미만이면 뜨지 않는다', () => {
    const r = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 3, meanDelta: 60 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').trigger).toBe(false);
  });

  it('전체가 빠를 때 정시인 패드를 "늦다"고 하지 않는다', () => {
    const r = evaluateRules(metrics({ meanDelta: -40, pads: [{ pad: 'SNARE', count: 5, meanDelta: -5 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').trigger).toBe(false);
  });

  it('빠른 패드는 LIVE_PAD_EARLY로 뜬다', () => {
    const r = evaluateRules(metrics({ meanDelta: 0, pads: [{ pad: 'RIDE', count: 5, meanDelta: -35 }] }), th);
    const e = find(r, 'LIVE_PAD_EARLY:RIDE');
    expect(e.trigger).toBe(true);
    expect(e.text).toBe('라이드에서 유독 빨라요.');
  });

  it('차이가 15ms 미만으로 줄면 거둔다', () => {
    const r = evaluateRules(metrics({ meanDelta: 20, pads: [{ pad: 'SNARE', count: 5, meanDelta: 30 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').release).toBe(true);
    const still = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 5, meanDelta: 30 }] }), th);
    expect(find(still, 'LIVE_PAD_LATE:SNARE').release).toBe(false);
  });
});

describe('LIVE_HAND_WEAK', () => {
  it('왼손 평균 세기가 오른손의 70% 미만이면 왼손 키로 뜬다', () => {
    const r = evaluateRules(metrics({ hands: hands({ count: 5, meanVelocity: 60 }, { count: 5, meanVelocity: 100 }) }), th);
    const e = find(r, 'LIVE_HAND_WEAK:0');
    expect(e.trigger).toBe(true);
    expect(e.text).toBe('왼손이 약해요. 양손 세기를 맞춰 보세요.');
    expect(find(r, 'LIVE_HAND_WEAK:1').trigger).toBe(false);
  });

  it('오른손이 약하면 오른손 키로 뜬다', () => {
    const r = evaluateRules(metrics({ hands: hands({ count: 6, meanVelocity: 100 }, { count: 6, meanVelocity: 60 }) }), th);
    const e = find(r, 'LIVE_HAND_WEAK:1');
    expect(e.trigger).toBe(true);
    expect(e.text.startsWith('오른손')).toBe(true);
  });

  it('한 손의 표본이 4개 미만이면 뜨지 않는다', () => {
    const r = evaluateRules(metrics({ hands: hands({ count: 3, meanVelocity: 30 }, { count: 8, meanVelocity: 100 }) }), th);
    expect(find(r, 'LIVE_HAND_WEAK:0').trigger).toBe(false);
  });

  it('비율이 0.8 이상으로 돌아오면 거둔다', () => {
    const r = evaluateRules(metrics({ hands: hands({ count: 5, meanVelocity: 85 }, { count: 5, meanVelocity: 100 }) }), th);
    expect(find(r, 'LIVE_HAND_WEAK:0').release).toBe(true);
    const mid = evaluateRules(metrics({ hands: hands({ count: 5, meanVelocity: 75 }, { count: 5, meanVelocity: 100 }) }), th);
    expect(find(mid, 'LIVE_HAND_WEAK:0').release).toBe(false);
    expect(find(mid, 'LIVE_HAND_WEAK:0').trigger).toBe(false);
  });
});

describe('LIVE_UNSTEADY', () => {
  it('편차 30ms 이상, 표본 10개 이상이면 뜬다', () => {
    expect(find(evaluateRules(metrics({ stdDelta: 35 }), th), 'LIVE_UNSTEADY').trigger).toBe(true);
    expect(find(evaluateRules(metrics({ stdDelta: 29 }), th), 'LIVE_UNSTEADY').trigger).toBe(false);
    expect(find(evaluateRules(metrics({ stdDelta: 40, validCount: 9 }), th), 'LIVE_UNSTEADY').trigger).toBe(false);
  });

  it('편차가 21ms 미만이면 거둔다', () => {
    expect(find(evaluateRules(metrics({ stdDelta: 20 }), th), 'LIVE_UNSTEADY').release).toBe(true);
    expect(find(evaluateRules(metrics({ stdDelta: 25 }), th), 'LIVE_UNSTEADY').release).toBe(false);
  });
});

describe('LIVE_MISS_STREAK', () => {
  it('연속 3번 놓치거나 최근 6개 중 4개를 놓치면 뜬다', () => {
    expect(find(evaluateRules(metrics({ trailingMisses: 3, missInRecent: 3 }), th), 'LIVE_MISS_STREAK').trigger).toBe(true);
    expect(find(evaluateRules(metrics({ trailingMisses: 1, missInRecent: 4 }), th), 'LIVE_MISS_STREAK').trigger).toBe(true);
    expect(find(evaluateRules(metrics({ trailingMisses: 2, missInRecent: 3 }), th), 'LIVE_MISS_STREAK').trigger).toBe(false);
  });

  it('최근 4개 중 놓침이 1개 이하면 거둔다', () => {
    expect(find(evaluateRules(metrics({ missInRelease: 1 }), th), 'LIVE_MISS_STREAK').release).toBe(true);
    expect(find(evaluateRules(metrics({ missInRelease: 2 }), th), 'LIVE_MISS_STREAK').release).toBe(false);
  });

  it('심한 정도는 놓침 비율 ÷ 0.6 이고 1을 넘지 않는다', () => {
    expect(find(evaluateRules(metrics({ trailingMisses: 3, missInRecent: 3 }), th), 'LIVE_MISS_STREAK').severity).toBeCloseTo(0.5 / 0.6);
    expect(find(evaluateRules(metrics({ trailingMisses: 6, missInRecent: 6 }), th), 'LIVE_MISS_STREAK').severity).toBe(1);
  });
});

describe('우선순위 값', () => {
  it('놓침 < 늦음·빠름 < 패드 < 손 < 박자 순으로 작다', () => {
    const r = evaluateRules(metrics(), th);
    const p = (k: string) => find(r, k).priority;
    expect(p('LIVE_MISS_STREAK')).toBeLessThan(p('LIVE_LATE'));
    expect(p('LIVE_LATE')).toBeLessThan(p('LIVE_PAD_LATE:SNARE'));
    expect(p('LIVE_PAD_LATE:SNARE')).toBeLessThan(p('LIVE_HAND_WEAK:0'));
    expect(p('LIVE_HAND_WEAK:0')).toBeLessThan(p('LIVE_UNSTEADY'));
  });
});
