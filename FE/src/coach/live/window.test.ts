import { describe, expect, it } from 'vitest';
import type { PadId } from '@/domain/kit/pads';
import { JudgedWindow, type JudgedNote } from './window';

let t = 0;
function note(over: Partial<JudgedNote> = {}): JudgedNote {
  t += 500;
  return {
    songTimeMs: t,
    noteTimeMs: t,
    judgement: 'PERFECT',
    deltaMs: 0,
    pad: 'SNARE',
    stickId: 0,
    velocity: 100,
    ...over,
  };
}
const hit = (deltaMs: number, over: Partial<JudgedNote> = {}) =>
  note({ judgement: Math.abs(deltaMs) <= 25 ? 'PERFECT' : 'GOOD', deltaMs, ...over });
const miss = (pad: PadId = 'SNARE') => note({ judgement: 'MISS', deltaMs: null, pad, stickId: null, velocity: null });

function windowOf(notes: JudgedNote[]): JudgedWindow {
  const w = new JudgedWindow();
  for (const n of notes) w.push(n);
  return w;
}

describe('JudgedWindow 평균·편차·부호', () => {
  it('평균과 모집단 표준편차를 계산한다', () => {
    const m = windowOf([hit(10), hit(20), hit(30)]).metrics();
    expect(m.validCount).toBe(3);
    expect(m.meanDelta).toBeCloseTo(20);
    expect(m.stdDelta).toBeCloseTo(Math.sqrt(200 / 3));
  });

  it('같은 부호 비율은 평균 부호 기준이다', () => {
    const m = windowOf([hit(20), hit(30), hit(25), hit(-5)]).metrics();
    expect(m.sameSignRatio).toBeCloseTo(0.75);
    const early = windowOf([hit(-20), hit(-30), hit(10)]).metrics();
    expect(early.meanDelta).toBeLessThan(0);
    expect(early.sameSignRatio).toBeCloseTo(2 / 3);
  });

  it('평균이 0이면 같은 부호 비율은 0이다', () => {
    const m = windowOf([hit(10), hit(-10)]).metrics();
    expect(m.meanDelta).toBeCloseTo(0);
    expect(m.sameSignRatio).toBe(0);
  });

  it('유효 타격이 없으면 지표가 null이다', () => {
    const m = windowOf([miss(), miss()]).metrics();
    expect(m.validCount).toBe(0);
    expect(m.meanDelta).toBeNull();
    expect(m.stdDelta).toBeNull();
    expect(m.sameSignRatio).toBeNull();
  });

  it('MISS는 평균·편차에 들어가지 않는다', () => {
    const m = windowOf([hit(10), miss(), hit(30)]).metrics();
    expect(m.validCount).toBe(2);
    expect(m.meanDelta).toBeCloseTo(20);
  });

  it('deltaMs가 NaN인 항목은 유효 타격으로 세지 않는다', () => {
    const m = windowOf([hit(10), note({ deltaMs: Number.NaN })]).metrics();
    expect(m.validCount).toBe(1);
  });
});

describe('JudgedWindow 창 크기', () => {
  it('판정 12개까지만 본다 (오래된 것은 밀려난다)', () => {
    const w = new JudgedWindow();
    for (let i = 0; i < 12; i++) w.push(hit(40));
    for (let i = 0; i < 12; i++) w.push(hit(0));
    const m = w.metrics();
    expect(m.validCount).toBe(12);
    expect(m.meanDelta).toBeCloseTo(0);
    expect(m.total).toBe(24);
  });

  it('reset은 누적 수와 창을 비운다', () => {
    const w = windowOf([hit(10), miss()]);
    w.reset();
    expect(w.total).toBe(0);
    expect(w.metrics().validCount).toBe(0);
  });
});

describe('JudgedWindow 놓침', () => {
  it('끝에서부터 이어진 MISS를 센다', () => {
    const m = windowOf([hit(0), miss(), miss(), miss()]).metrics();
    expect(m.trailingMisses).toBe(3);
    const broken = windowOf([miss(), miss(), hit(0), miss()]).metrics();
    expect(broken.trailingMisses).toBe(1);
  });

  it('최근 6개 중 MISS 수와 최근 4개 중 MISS 수를 센다', () => {
    const m = windowOf([miss(), miss(), hit(0), hit(0), miss(), hit(0), miss()]).metrics();
    // 최근 6개 = miss, hit, hit, miss, hit, miss → MISS 3
    expect(m.missInRecent).toBe(3);
    // 최근 4개 = hit, miss, hit, miss → MISS 2
    expect(m.missInRelease).toBe(2);
  });

  it('창 12개 안의 MISS 수를 세고 창 밖의 MISS는 뺀다', () => {
    const hits = Array.from({ length: 11 }, () => hit(0));
    expect(windowOf([miss(), miss(), ...hits, miss()]).metrics().missInWindow).toBe(1);
  });
});

describe('JudgedWindow 패드별', () => {
  it('패드마다 개수와 평균 지연을 낸다', () => {
    const m = windowOf([
      hit(40, { pad: 'HIHAT' }),
      hit(50, { pad: 'HIHAT' }),
      hit(0, { pad: 'SNARE' }),
      hit(-10, { pad: 'SNARE' }),
      miss('KICK'),
    ]).metrics();
    const hh = m.pads.find((p) => p.pad === 'HIHAT');
    const sn = m.pads.find((p) => p.pad === 'SNARE');
    expect(hh).toEqual({ pad: 'HIHAT', count: 2, meanDelta: 45, sameSignRatio: 1 });
    expect(sn?.count).toBe(2);
    expect(sn?.meanDelta).toBeCloseTo(-5);
    // MISS뿐인 패드는 통계에 없다
    expect(m.pads.find((p) => p.pad === 'KICK')).toBeUndefined();
  });
});

describe('JudgedWindow 손별 세기', () => {
  it('손마다 평균 세기를 낸다', () => {
    const m = windowOf([
      hit(0, { stickId: 0, velocity: 60 }),
      hit(0, { stickId: 0, velocity: 80 }),
      hit(0, { stickId: 1, velocity: 100 }),
    ]).metrics();
    expect(m.hands[0]).toEqual({ count: 2, meanVelocity: 70 });
    expect(m.hands[1]).toEqual({ count: 1, meanVelocity: 100 });
  });

  it('손 정보가 없는 타격(키보드·MISS)은 제외한다', () => {
    const m = windowOf([
      hit(0, { stickId: null, velocity: null }),
      hit(0, { stickId: 1, velocity: 90 }),
      miss(),
    ]).metrics();
    expect(m.hands[0].count).toBe(0);
    expect(m.hands[0].meanVelocity).toBe(0);
    expect(m.hands[1].count).toBe(1);
  });

  it('손별 세기는 16개 창으로 본다 (12개 창보다 넓다)', () => {
    const w = new JudgedWindow();
    for (let i = 0; i < 4; i++) w.push(hit(0, { stickId: 1, velocity: 10 }));
    for (let i = 0; i < 12; i++) w.push(hit(0, { stickId: 0, velocity: 100 }));
    const m = w.metrics();
    // 지연 지표는 최근 12개, 손별은 최근 16개
    expect(m.validCount).toBe(12);
    expect(m.hands[1].count).toBe(4);
    expect(m.hands[0].count).toBe(12);
  });
});

describe('패드별 놓침', () => {
  it('최근 16개에서 패드별 놓침과 노트 수를 센다', () => {
    const w = new JudgedWindow();
    const note = (pad: 'SNARE' | 'SMALL_TOM', judgement: 'GOOD' | 'MISS') =>
      w.push({ songTimeMs: 0, noteTimeMs: 0, judgement, deltaMs: judgement === 'MISS' ? null : 5, pad, stickId: null, velocity: null });
    for (let i = 0; i < 4; i++) note('SNARE', 'MISS'); // 창 밖으로 밀려난다
    for (let i = 0; i < 13; i++) note('SNARE', 'GOOD');
    for (let i = 0; i < 3; i++) note('SMALL_TOM', 'MISS');
    const m = w.metrics();
    expect(m.missInPadWindow).toBe(3);
    expect(m.padMisses).toEqual(expect.arrayContaining([{ pad: 'SNARE', misses: 0, notes: 13 }, { pad: 'SMALL_TOM', misses: 3, notes: 3 }]));
  });
});
