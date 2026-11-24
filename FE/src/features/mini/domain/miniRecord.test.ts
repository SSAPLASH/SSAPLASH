import { describe, expect, it } from 'vitest';
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
  const SHOTS = [
    { level: 'strong', target: 110, actual: 104 },
    { level: 'weak', target: 40, actual: 49 },
    { level: 'mid', target: 80, actual: 82 },
  ];

  function dynRec(score: number, shots: unknown = SHOTS): unknown {
    return { gameId: 'dynamics', score, at: AT, detail: { shots } };
  }

  it('recordKey는 게임 id다', () => {
    expect(recordKey('dynamics')).toBe('dynamics');
  });

  it('cardRecord가 그 기록을 돌려준다', () => {
    const records = parseRecords(raw({ dynamics: dynRec(94) }));
    expect(cardRecord(records, 'dynamics')).toEqual({ record: records.dynamics });
    expect(records.dynamics.gameId).toBe('dynamics');
  });

  it('맞는 dynamics 기록은 살린다', () => {
    const parsed = parseRecords(raw({ dynamics: dynRec(94) }));
    expect(parsed).toEqual({ dynamics: { gameId: 'dynamics', score: 94, at: AT, detail: { shots: SHOTS } } });
  });

  it('dynamics의 detail만 깨졌으면 그 기록만 버리고 speed는 살린다', () => {
    const parsed = parseRecords(raw({ speed: rec(60), dynamics: dynRec(94, SHOTS.slice(0, 2)) }));
    expect(parsed).toEqual({ speed: rec(60) });
  });

  it('speed의 detail만 깨졌으면 그 기록만 버리고 dynamics는 살린다', () => {
    const parsed = parseRecords(raw({ speed: { ...rec(60), detail: { perSecond: [1] } }, dynamics: dynRec(94) }));
    expect(Object.keys(parsed)).toEqual(['dynamics']);
  });

  it('게임 id와 detail 모양이 어긋나면 버린다', () => {
    const parsed = parseRecords(
      raw({
        dynamics: { ...rec(60), gameId: 'dynamics' },
        speed: { ...(dynRec(94) as object), gameId: 'speed' },
      }),
    );
    expect(parsed).toEqual({});
  });

  it('두 게임 기록이 serializeRecords → parseRecords로 왕복한다', () => {
    const records = parseRecords(raw({ speed: rec(60), dynamics: dynRec(94) }));
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
