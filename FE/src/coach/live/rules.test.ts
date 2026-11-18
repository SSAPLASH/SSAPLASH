import { describe, expect, it } from 'vitest';
import { STICK_PADS } from '@/domain/kit/pads';
import { liveThresholds } from './config';
import { evaluatePraise, evaluateRules, isPraiseTag, RECOVERED_PRAISE, type RuleEvaluation } from './rules';
import type { HandStat, WindowMetrics } from './window';

function metrics(over: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    total: 12,
    validCount: 12,
    meanDelta: 0,
    sameSignRatio: 0.5,
    stdDelta: 5,
    missInWindow: 0,
    missInRecent: 0,
    trailingMisses: 0,
    missInRelease: 0,
    pads: [],
    missInPadWindow: 0,
    padMisses: [],
    setup: { judged: 0, validCount: 0, meanDelta: null, stdDelta: null, sameSignRatio: null, misses: 0, strayHits: 0 },
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
  it('한 패드가 나머지 패드보다 27ms 이상 늦으면 그 패드 키로 뜬다', () => {
    const r = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 4, meanDelta: 40, sameSignRatio: 1 }] }), th);
    const e = find(r, 'LIVE_PAD_LATE:SNARE');
    expect(e.trigger).toBe(true);
    expect(e.tag).toBe('LIVE_PAD_LATE');
    expect(e.text).toBe('스네어에서 유독 늦어요.');
    expect(find(r, 'LIVE_PAD_LATE:HIHAT').trigger).toBe(false);
    expect(find(r, 'LIVE_PAD_EARLY:SNARE').trigger).toBe(false);
  });

  it('나머지와의 차이가 27ms 미만이면 뜨지 않는다', () => {
    // 나머지 평균 = (12×5 − 5×15) ÷ 7 ≈ -2.1, 차이 ≈ 17
    const r = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 5, meanDelta: 15, sameSignRatio: 1 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').trigger).toBe(false);
  });

  it('나머지 패드 표본이 4개 미만이면 비교하지 않는다 (창 대부분이 그 패드)', () => {
    const r = evaluateRules(metrics({ validCount: 8, meanDelta: 40, pads: [{ pad: 'SNARE', count: 5, meanDelta: 60, sameSignRatio: 1 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').trigger).toBe(false);
  });

  it('그 패드 타격이 한쪽으로 쏠리지 않았으면(같은 방향 비율 미달) 평균이 커도 뜨지 않는다', () => {
    const r = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 4, meanDelta: 40, sameSignRatio: 0.75 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').trigger).toBe(false);
  });

  it('그 패드 표본이 4개 미만이면 뜨지 않는다', () => {
    const r = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 3, meanDelta: 60, sameSignRatio: 1 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').trigger).toBe(false);
  });

  it('전체가 빠를 때 정시인 패드를 "늦다"고 하지 않는다', () => {
    const r = evaluateRules(metrics({ meanDelta: -40, pads: [{ pad: 'SNARE', count: 5, meanDelta: -5, sameSignRatio: 1 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').trigger).toBe(false);
  });

  it('빠른 패드는 LIVE_PAD_EARLY로 뜬다', () => {
    const r = evaluateRules(metrics({ meanDelta: 0, pads: [{ pad: 'RIDE', count: 5, meanDelta: -35, sameSignRatio: 1 }] }), th);
    const e = find(r, 'LIVE_PAD_EARLY:RIDE');
    expect(e.trigger).toBe(true);
    expect(e.text).toBe('라이드에서 유독 빨라요.');
  });

  it('차이가 15ms 미만으로 줄면 거둔다', () => {
    // 나머지 평균 = (12×20 − 5×25) ÷ 7 ≈ 16.4, 차이 ≈ 8.6
    const r = evaluateRules(metrics({ meanDelta: 20, pads: [{ pad: 'SNARE', count: 5, meanDelta: 25, sameSignRatio: 1 }] }), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').release).toBe(true);
    const still = evaluateRules(metrics({ meanDelta: 5, pads: [{ pad: 'SNARE', count: 5, meanDelta: 30, sameSignRatio: 1 }] }), th);
    expect(find(still, 'LIVE_PAD_LATE:SNARE').release).toBe(false);
  });
});

describe('target과 페달 제외', () => {
  it('패드 규칙에 킥·하이햇 페달 항목이 없고 스틱 패드마다 늦음·빠름 두 항목이 있다', () => {
    const r = evaluateRules(metrics(), th);
    expect(r.some((e) => e.key.includes('KICK') || e.key.includes('HIHAT_PEDAL'))).toBe(false);
    expect(r.filter((e) => e.tag === 'LIVE_PAD_LATE')).toHaveLength(STICK_PADS.length);
    expect(r.filter((e) => e.tag === 'LIVE_PAD_EARLY')).toHaveLength(STICK_PADS.length);
  });

  it('패드·손 규칙만 target을 채우고 나머지는 null이다', () => {
    const r = evaluateRules(metrics(), th);
    expect(find(r, 'LIVE_PAD_LATE:SNARE').target).toEqual({ kind: 'pad', pad: 'SNARE' });
    expect(find(r, 'LIVE_PAD_EARLY:RIDE').target).toEqual({ kind: 'pad', pad: 'RIDE' });
    expect(find(r, 'LIVE_HAND_WEAK:0').target).toEqual({ kind: 'hand', hand: 0 });
    expect(find(r, 'LIVE_HAND_WEAK:1').target).toEqual({ kind: 'hand', hand: 1 });
    for (const key of ['LIVE_MISS_STREAK', 'LIVE_LATE', 'LIVE_EARLY', 'LIVE_UNSTEADY']) expect(find(r, key).target).toBeNull();
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

describe('LIVE_PAD_MISS', () => {
  const miss = (over: Partial<WindowMetrics>) => evaluateRules(metrics(over), th);

  it('놓침이 한 패드에 몰리면 그 패드를 안내한다', () => {
    const r = miss({ missInPadWindow: 4, padMisses: [{ pad: 'SMALL_TOM', misses: 3, notes: 5 }, { pad: 'SNARE', misses: 1, notes: 11 }] });
    const e = find(r, 'LIVE_PAD_MISS:SMALL_TOM');
    expect(e.trigger).toBe(true);
    expect(e.target).toEqual({ kind: 'pad', pad: 'SMALL_TOM' });
    expect(e.text).toContain('스몰탐을');
    expect(find(r, 'LIVE_PAD_MISS:SNARE').trigger).toBe(false);
  });

  it('전체 놓침이 적으면 띄우지 않는다', () => {
    expect(find(miss({ missInPadWindow: 3, padMisses: [{ pad: 'SNARE', misses: 3, notes: 4 }] }), 'LIVE_PAD_MISS:SNARE').trigger).toBe(false);
  });

  it('놓침이 여러 패드에 흩어지면 띄우지 않는다', () => {
    const r = miss({ missInPadWindow: 6, padMisses: [{ pad: 'SNARE', misses: 3, notes: 5 }, { pad: 'HIHAT', misses: 3, notes: 5 }] });
    expect(find(r, 'LIVE_PAD_MISS:SNARE').trigger).toBe(false);
  });

  it('노트가 많은 패드는 놓침 비율이 낮으면 띄우지 않는다', () => {
    const r = miss({ missInPadWindow: 4, padMisses: [{ pad: 'HIHAT', misses: 4, notes: 14 }] });
    expect(find(r, 'LIVE_PAD_MISS:HIHAT').trigger).toBe(false);
  });

  it('페달은 평가하지 않는다', () => {
    const r = miss({ missInPadWindow: 4, padMisses: [{ pad: 'KICK', misses: 4, notes: 4 }] });
    expect(r.some((e) => e.key === 'LIVE_PAD_MISS:KICK')).toBe(false);
  });

  it('그 패드의 놓침이 1개 이하가 되면 거둔다', () => {
    expect(find(miss({ missInPadWindow: 1, padMisses: [{ pad: 'SNARE', misses: 1, notes: 6 }] }), 'LIVE_PAD_MISS:SNARE').release).toBe(true);
    expect(find(miss({ missInPadWindow: 2, padMisses: [{ pad: 'SNARE', misses: 2, notes: 6 }] }), 'LIVE_PAD_MISS:SNARE').release).toBe(false);
  });
});

describe('우선순위 값', () => {
  it('패드 놓침 < 놓침 < 늦음·빠름 < 패드 < 손 < 박자 순으로 작다', () => {
    const r = evaluateRules(metrics(), th);
    const p = (k: string) => find(r, k).priority;
    expect(p('LIVE_PAD_MISS:SNARE')).toBeLessThan(p('LIVE_MISS_STREAK'));
    expect(p('LIVE_MISS_STREAK')).toBeLessThan(p('LIVE_LATE'));
    expect(p('LIVE_LATE')).toBeLessThan(p('LIVE_PAD_LATE:SNARE'));
    expect(p('LIVE_PAD_LATE:SNARE')).toBeLessThan(p('LIVE_HAND_WEAK:0'));
    expect(p('LIVE_HAND_WEAK:0')).toBeLessThan(p('LIVE_UNSTEADY'));
  });
});

describe('evaluatePraise', () => {
  it('놓침 없이 평균·편차가 거두는 문턱 안이면 안정 칭찬이다', () => {
    expect(evaluatePraise(metrics({ meanDelta: 8.9, stdDelta: 20.9 }), th)?.tag).toBe('LIVE_GOOD_STEADY');
  });

  it('평균이 문턱에 닿으면 계속 칭찬으로 내려간다', () => {
    expect(evaluatePraise(metrics({ meanDelta: -9 }), th)?.tag).toBe('LIVE_GOOD_KEEP');
  });

  it('편차가 문턱에 닿으면 계속 칭찬으로 내려간다', () => {
    expect(evaluatePraise(metrics({ stdDelta: 21 }), th)?.tag).toBe('LIVE_GOOD_KEEP');
  });

  it('놓침이 하나라도 있으면 안정 칭찬도 계속 칭찬도 없다', () => {
    expect(evaluatePraise(metrics({ missInWindow: 1 }), th)).toBeNull();
  });

  it('유효 타격이 8개 미만이면 안정 칭찬이 아니다', () => {
    expect(evaluatePraise(metrics({ validCount: 7 }), th)?.tag).toBe('LIVE_GOOD_KEEP');
  });

  it('놓침이 없으면 칭찬 후보가 있고 1개부터는 없다', () => {
    expect(evaluatePraise(metrics({ missInWindow: 0 }), th)).not.toBeNull();
    expect(evaluatePraise(metrics({ missInWindow: 1 }), th)).toBeNull();
    expect(evaluatePraise(metrics({ missInWindow: 3 }), th)).toBeNull();
  });

  it('칭찬 태그만 isPraiseTag가 참이다', () => {
    expect(isPraiseTag(RECOVERED_PRAISE.tag)).toBe(true);
    expect(isPraiseTag('LIVE_GOOD_KEEP')).toBe(true);
    expect(isPraiseTag('LIVE_LATE')).toBe(false);
    expect(isPraiseTag('LIVE_RECOVERED')).toBe(false);
  });
});
