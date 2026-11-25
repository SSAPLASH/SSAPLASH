import { describe, expect, it } from 'vitest';
import { SIGHT_VARIANTS } from './sightRound';
import { cardRecord, isNewBest, parseRecords, recordKey, serializeRecords, type MiniRecord, type MiniRecords } from './miniRecord';

const PER_SECOND = [3, 4, 5, 6, 7, 8, 7, 6, 5, 4];
const AT = '2026-11-23T10:00:00.000Z';

function rec(score: number, variant?: string): MiniRecord {
  const base = { gameId: 'speed' as const, score, at: AT, detail: { perSecond: PER_SECOND } };
  return variant === undefined ? base : { ...base, variant };
}

function raw(records: Record<string, unknown>, v = 1): string {
  return JSON.stringify({ v, records });
}

describe('isNewBest', () => {
  it('이전 기록이 없으면 새 최고다', () => {
    expect(isNewBest(null, 10, 'higher')).toBe(true);
    expect(isNewBest(undefined, 10, 'lower')).toBe(true);
  });

  it('higher: 더 크면 갱신, 같거나 작으면 갱신 아님', () => {
    expect(isNewBest({ score: 50 }, 51, 'higher')).toBe(true);
    expect(isNewBest({ score: 50 }, 50, 'higher')).toBe(false);
    expect(isNewBest({ score: 50 }, 49, 'higher')).toBe(false);
  });

  it('lower: 더 작으면 갱신, 같거나 크면 갱신 아님', () => {
    expect(isNewBest({ score: 50 }, 49, 'lower')).toBe(true);
    expect(isNewBest({ score: 50 }, 50, 'lower')).toBe(false);
    expect(isNewBest({ score: 50 }, 51, 'lower')).toBe(false);
  });
});

describe('recordKey', () => {
  it('갈래가 없으면 게임 id', () => {
    expect(recordKey('speed')).toBe('speed');
  });

  it('갈래가 있으면 `게임 id:갈래`', () => {
    expect(recordKey('speed', 'a')).toBe('speed:a');
  });
});

describe('parseRecords', () => {
  it('null·undefined·빈 문자열은 빈 값', () => {
    expect(parseRecords(null)).toEqual({});
    expect(parseRecords(undefined)).toEqual({});
    expect(parseRecords('')).toEqual({});
  });

  it('JSON이 아니면 빈 값', () => {
    expect(parseRecords('{깨진')).toEqual({});
  });

  it('버전이 다르면 빈 값', () => {
    expect(parseRecords(raw({ speed: rec(10) }, 2))).toEqual({});
    expect(parseRecords(JSON.stringify({ records: { speed: rec(10) } }))).toEqual({});
  });

  it('records가 객체가 아니면 빈 값', () => {
    expect(parseRecords(JSON.stringify({ v: 1, records: [rec(10)] }))).toEqual({});
    expect(parseRecords(JSON.stringify({ v: 1, records: 'x' }))).toEqual({});
    expect(parseRecords(JSON.stringify({ v: 1, records: null }))).toEqual({});
    expect(parseRecords(JSON.stringify([1, 2]))).toEqual({});
  });

  it('serializeRecords → parseRecords로 왕복한다', () => {
    const records: MiniRecords = { speed: rec(60), 'speed:a': rec(70, 'a') };
    expect(parseRecords(serializeRecords(records))).toEqual(records);
  });

  it('한 기록의 detail만 깨졌으면 그 기록만 버리고 나머지는 살린다', () => {
    const broken = { ...rec(70, 'a'), detail: { perSecond: [1, 2, 3] } };
    expect(parseRecords(raw({ speed: rec(60), 'speed:a': broken }))).toEqual({ speed: rec(60) });
    expect(parseRecords(raw({ speed: { ...rec(60), detail: null }, 'speed:a': rec(70, 'a') }))).toEqual({ 'speed:a': rec(70, 'a') });
  });

  it('모르는 게임 id의 기록만 버린다', () => {
    const parsed = parseRecords(raw({ speed: rec(60), ghost: { ...rec(5), gameId: 'ghost' } }));
    expect(Object.keys(parsed)).toEqual(['speed']);
  });

  it('점수가 숫자가 아닌 기록만 버린다', () => {
    const parsed = parseRecords(raw({ speed: { ...rec(60), score: '60' }, 'speed:a': rec(70, 'a') }));
    expect(Object.keys(parsed)).toEqual(['speed:a']);
  });

  it('at이 날짜가 아닌 기록만 버린다', () => {
    const parsed = parseRecords(raw({ speed: { ...rec(60), at: '어제' }, 'speed:a': rec(70, 'a') }));
    expect(Object.keys(parsed)).toEqual(['speed:a']);
  });

  it('키와 내용이 어긋난 기록만 버린다(`speed:a` 키에 갈래 없는 기록)', () => {
    const parsed = parseRecords(raw({ 'speed:a': rec(60), speed: rec(70) }));
    expect(parsed).toEqual({ speed: rec(70) });
  });
});

describe('강약중강약(dynamics) 기록', () => {
  const FEEL = [42, 78, 109];
  const SHOTS = [
    { target: 96, actual: 90 },
    { target: 52, actual: 61 },
    { target: 74, actual: 72 },
  ];
  // 예전(100점제) 모양: feel이 없고 shots에 level이 있다
  const LEGACY_SHOTS = [
    { level: 'strong', target: 110, actual: 104 },
    { level: 'weak', target: 40, actual: 49 },
    { level: 'mid', target: 80, actual: 82 },
  ];

  function dynRec(score: number, shots: unknown = SHOTS, feel: unknown = FEEL): unknown {
    return { gameId: 'dynamics', score, at: AT, detail: { feel, shots } };
  }

  it('recordKey는 게임 id다', () => {
    expect(recordKey('dynamics')).toBe('dynamics');
  });

  it('cardRecord가 그 기록을 돌려준다', () => {
    const records = parseRecords(raw({ dynamics: dynRec(17) }));
    expect(cardRecord(records, 'dynamics')).toEqual({ record: records.dynamics });
    expect(records.dynamics.gameId).toBe('dynamics');
  });

  it('맞는 dynamics 기록은 살린다', () => {
    const parsed = parseRecords(raw({ dynamics: dynRec(17) }));
    expect(parsed).toEqual({ dynamics: { gameId: 'dynamics', score: 17, at: AT, detail: { feel: FEEL, shots: SHOTS } } });
  });

  it('dynamics의 detail만 깨졌으면 그 기록만 버리고 speed는 살린다', () => {
    const parsed = parseRecords(raw({ speed: rec(60), dynamics: dynRec(17, SHOTS.slice(0, 2)) }));
    expect(parsed).toEqual({ speed: rec(60) });
  });

  it('예전 모양(feel 없이 level이 든 shots)의 dynamics 기록은 그 기록만 버리고 speed는 살린다', () => {
    const legacy = { gameId: 'dynamics', score: 94, at: AT, detail: { shots: LEGACY_SHOTS } };
    const parsed = parseRecords(raw({ speed: rec(60), dynamics: legacy }));
    expect(parsed).toEqual({ speed: rec(60) });
  });

  it('feel이 3개가 아닌 dynamics 기록은 버린다', () => {
    expect(parseRecords(raw({ dynamics: dynRec(17, SHOTS, [42, 78]) }))).toEqual({});
  });

  it('speed의 detail만 깨졌으면 그 기록만 버리고 dynamics는 살린다', () => {
    const parsed = parseRecords(raw({ speed: { ...rec(60), detail: { perSecond: [1] } }, dynamics: dynRec(17) }));
    expect(Object.keys(parsed)).toEqual(['dynamics']);
  });

  it('게임 id와 detail 모양이 어긋나면 버린다', () => {
    const parsed = parseRecords(
      raw({
        dynamics: { ...rec(60), gameId: 'dynamics' },
        speed: { ...(dynRec(17) as object), gameId: 'speed' },
      }),
    );
    expect(parsed).toEqual({});
  });

  it('dynamics는 낮을수록 좋은 기록이다(17 → 14는 갱신, 17 → 17·20은 갱신 아님)', () => {
    expect(isNewBest({ score: 17 }, 14, 'lower')).toBe(true);
    expect(isNewBest({ score: 17 }, 17, 'lower')).toBe(false);
    expect(isNewBest({ score: 17 }, 20, 'lower')).toBe(false);
  });

  it('두 게임 기록이 serializeRecords → parseRecords로 왕복한다', () => {
    const records = parseRecords(raw({ speed: rec(60), dynamics: dynRec(17) }));
    expect(Object.keys(records).sort()).toEqual(['dynamics', 'speed']);
    expect(parseRecords(serializeRecords(records))).toEqual(records);
  });
});

describe('cardRecord', () => {
  const variants = [
    { id: 'a', name: '갈래 A' },
    { id: 'b', name: '갈래 B' },
  ];

  it('갈래 없는 게임은 그 게임의 기록을 돌려준다', () => {
    const records: MiniRecords = { speed: rec(60) };
    expect(cardRecord(records, 'speed')).toEqual({ record: rec(60) });
    expect(cardRecord(records, 'speed', [])).toEqual({ record: rec(60) });
  });

  it('첫 갈래 기록이 있으면 꼬리말 없이 돌려준다', () => {
    const records: MiniRecords = { 'speed:a': rec(60, 'a'), 'speed:b': rec(90, 'b') };
    expect(cardRecord(records, 'speed', variants)).toEqual({ record: rec(60, 'a') });
  });

  it('첫 갈래 기록이 없고 둘째만 있으면 둘째 기록과 갈래 이름을 돌려준다', () => {
    const records: MiniRecords = { 'speed:b': rec(90, 'b') };
    expect(cardRecord(records, 'speed', variants)).toEqual({ record: rec(90, 'b'), variantName: '갈래 B' });
  });

  it('아무 기록도 없으면 null', () => {
    expect(cardRecord({}, 'speed')).toBeNull();
    expect(cardRecord({}, 'speed', variants)).toBeNull();
  });
});

// 악보 보고 빨리 치기(sight): 낮을수록 좋고 갈래가 둘이다
const SIGHT_PROBLEMS_DETAIL = Array.from({ length: 10 }, () => ({ pad: 'SNARE', ms: 400, wrongs: 0, timedOut: false }));

function sightRec(score: number, variant?: string, problems: unknown[] = SIGHT_PROBLEMS_DETAIL) {
  const base = { gameId: 'sight', score, at: AT, detail: { problems } };
  return variant === undefined ? base : { ...base, variant };
}

describe('sight 기록', () => {
  it('recordKey는 게임 id:갈래', () => {
    expect(recordKey('sight', 'hint-off')).toBe('sight:hint-off');
  });

  it('두 갈래 기록이 speed 기록과 나란히 살아남는다', () => {
    const parsed = parseRecords(
      raw({
        speed: rec(60),
        'sight:hint-off': sightRec(520, 'hint-off'),
        'sight:hint-on': sightRec(470, 'hint-on'),
      }),
    );
    expect(Object.keys(parsed).sort()).toEqual(['sight:hint-off', 'sight:hint-on', 'speed']);
    expect(parsed['sight:hint-off'].score).toBe(520);
    expect(parsed['sight:hint-on'].score).toBe(470);
  });

  it('detail이 깨진 sight 기록(9문제)은 그 기록만 버린다', () => {
    const parsed = parseRecords(
      raw({
        speed: rec(60),
        'sight:hint-off': sightRec(520, 'hint-off', SIGHT_PROBLEMS_DETAIL.slice(0, 9)),
        'sight:hint-on': sightRec(470, 'hint-on'),
      }),
    );
    expect(Object.keys(parsed).sort()).toEqual(['sight:hint-on', 'speed']);
  });

  it('키와 내용의 갈래가 어긋난 sight 기록은 버린다', () => {
    expect(parseRecords(raw({ 'sight:hint-off': sightRec(470, 'hint-on') }))).toEqual({});
    expect(parseRecords(raw({ sight: sightRec(470, 'hint-on') }))).toEqual({});
  });
});

describe('isNewBest: lower', () => {
  it('낮으면 갱신, 같거나 높으면 갱신 아님, 이전이 없으면 갱신', () => {
    expect(isNewBest({ score: 520 }, 470, 'lower')).toBe(true);
    expect(isNewBest({ score: 520 }, 520, 'lower')).toBe(false);
    expect(isNewBest({ score: 520 }, 570, 'lower')).toBe(false);
    expect(isNewBest(null, 470, 'lower')).toBe(true);
  });
});

describe('cardRecord: sight', () => {
  const off = sightRec(520, 'hint-off') as MiniRecord;
  const on = sightRec(470, 'hint-on') as MiniRecord;

  it('힌트 끔 기록이 있으면 꼬리말 없이 그 기록', () => {
    expect(cardRecord({ 'sight:hint-off': off }, 'sight', SIGHT_VARIANTS)).toEqual({ record: off });
  });

  it('힌트 켬 기록만 있으면 갈래 이름을 붙인다', () => {
    expect(cardRecord({ 'sight:hint-on': on }, 'sight', SIGHT_VARIANTS)).toEqual({ record: on, variantName: '힌트 켬' });
  });

  it('둘 다 있으면 힌트 끔', () => {
    expect(cardRecord({ 'sight:hint-off': off, 'sight:hint-on': on }, 'sight', SIGHT_VARIANTS)).toEqual({ record: off });
  });

  it('없으면 null', () => {
    expect(cardRecord({}, 'sight', SIGHT_VARIANTS)).toBeNull();
  });
});

describe('tempo 기록', () => {
  const errors = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 0 : i % 2 === 0 ? -i : i));
  const tempoRec = (score: number, detail: unknown = { bpm: 96, errors: errors(16) }) => ({ gameId: 'tempo', score, at: AT, detail });

  it('recordKey는 게임 id 그대로', () => {
    expect(recordKey('tempo')).toBe('tempo');
  });

  it('올바른 tempo 기록은 다른 게임 기록 옆에서 살아남는다', () => {
    const parsed = parseRecords(raw({ speed: rec(40), tempo: tempoRec(16) }));
    expect(Object.keys(parsed).sort()).toEqual(['speed', 'tempo']);
    expect(parsed.tempo).toEqual(tempoRec(16));
  });

  it('detail이 깨진 tempo 기록만 버린다', () => {
    const parsed = parseRecords(raw({ speed: rec(40), tempo: tempoRec(16, { bpm: 96, errors: errors(15) }) }));
    expect(Object.keys(parsed)).toEqual(['speed']);
    expect(parseRecords(raw({ tempo: tempoRec(16, { bpm: 300, errors: errors(16) }) }))).toEqual({});
  });

  it('cardRecord는 그 기록을 돌려준다', () => {
    const record = tempoRec(16) as MiniRecord;
    expect(cardRecord({ tempo: record }, 'tempo')).toEqual({ record });
    expect(cardRecord({}, 'tempo')).toBeNull();
  });

  it('isNewBest lower: 15는 16을 이기고 16은 16과 같아 갱신이 아니다', () => {
    expect(isNewBest({ score: 16 }, 15, 'lower')).toBe(true);
    expect(isNewBest({ score: 16 }, 16, 'lower')).toBe(false);
  });
});
