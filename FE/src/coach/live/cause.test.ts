// 합성 연주로 원인별로 맞는 원인이 나오는지 확인한다(설계 6절 인수 조건).
import { describe, expect, it } from 'vitest';
import type { PadId } from '@/domain/kit/pads';
import { missCauses, pickCauseByRule, UNKNOWN_CAUSE, type CauseInput } from './cause';
import type { JudgedNote, StrayHit } from './window';

const GAP = 500;
const at = (i: number) => 4_000 + i * GAP;

function hit(i: number, pad: PadId, deltaMs = 0, over: Partial<JudgedNote> = {}): JudgedNote {
  return { songTimeMs: at(i) + deltaMs, noteTimeMs: at(i), judgement: 'GOOD', deltaMs, pad, stickId: 0, velocity: 90, ...over };
}
function miss(i: number, pad: PadId, over: Partial<JudgedNote> = {}): JudgedNote {
  return { songTimeMs: at(i) + 60, noteTimeMs: at(i), judgement: 'MISS', deltaMs: null, pad, stickId: null, velocity: null, ...over };
}
const input = (notes: JudgedNote[], over: Partial<CauseInput> = {}): CauseInput => ({
  notes,
  strays: [],
  stage: 3,
  goodMs: 60,
  noteGapMedianMs: GAP,
  ...over,
});
const causes = (i: CauseInput) => missCauses(i).map((c) => c.cause);

describe('놓침 원인: 패드 이동', () => {
  // 스네어 → 스몰탐으로 넘어갈 때만 놓친다. 하이햇 → 스몰탐(비교 대상)은 친다
  const notes: JudgedNote[] = [];
  for (let k = 0; k < 4; k++) {
    notes.push(hit(4 * k, 'SNARE', 0, { prevPads: ['SMALL_TOM'], prevGapMs: GAP }));
    notes.push(miss(4 * k + 1, 'SMALL_TOM', { prevPads: ['SNARE'], prevGapMs: GAP }));
    notes.push(hit(4 * k + 2, 'HIHAT', 0, { prevPads: ['SMALL_TOM'], prevGapMs: GAP }));
    notes.push(hit(4 * k + 3, 'SMALL_TOM', 0, { prevPads: ['HIHAT'], prevGapMs: GAP }));
  }

  it('같은 이동에서 반복해 놓치면 TRANSITION과 출발 패드가 나온다', () => {
    const [c] = missCauses(input(notes));
    expect(c).toMatchObject({ cause: 'TRANSITION', pad: 'SMALL_TOM', fromPad: 'SNARE' });
    expect(c.strength).toBe(1);
  });

  it('같은 패드를 다른 곳에서 넘어온 노트가 없으면 이동 탓인지 가를 수 없어 TRANSITION이 아니다', () => {
    const only = notes.filter((n) => !(n.pad === 'SMALL_TOM' && n.prevPads?.[0] === 'HIHAT'));
    expect(causes(input(only))).not.toContain('TRANSITION');
  });

  it('비교 대상도 비슷하게 놓치면 TRANSITION이 아니다', () => {
    // 비교 대상(하이햇 → 스몰탐) 4개 중 앞의 둘을 놓쳤다: 이동 놓침 비율 1.0 < 2.5 × 0.5
    const both = notes.map((n, i) => (i === 3 || i === 7 ? miss(i, 'SMALL_TOM', { prevPads: ['HIHAT'], prevGapMs: GAP }) : n));
    expect(causes(input(both))).not.toContain('TRANSITION');
    // 하나만 놓쳤으면(0.25) 1.0 ≥ 2.5 × 0.25라 이동 탓이다
    const one = notes.map((n, i) => (i === 3 ? miss(i, 'SMALL_TOM', { prevPads: ['HIHAT'], prevGapMs: GAP }) : n));
    expect(causes(input(one))).toContain('TRANSITION');
  });

  it('2단계에서는 패드 이동을 말하지 않는다', () => {
    expect(causes(input(notes, { stage: 2 }))).not.toContain('TRANSITION');
  });

  it('킥(페달)에서 넘어온 것은 손 이동으로 보지 않는다', () => {
    const fromKick = notes.map((n) => (n.judgement === 'MISS' ? { ...n, prevPads: ['KICK'] as PadId[] } : n));
    expect(causes(input(fromKick))).not.toContain('TRANSITION');
  });

  it('직전 패드 정보가 없으면 계산하지 않는다', () => {
    const bare = notes.map(({ prevPads: _p, ...n }) => n);
    expect(causes(input(bare))).not.toContain('TRANSITION');
  });
});

describe('놓침 원인: 빠른 구간', () => {
  // 간격이 곡 중앙값의 절반인 곳에서만 놓친다
  const notes: JudgedNote[] = [];
  for (let i = 0; i < 12; i++) {
    const fast = i % 3 === 2;
    notes.push(fast ? miss(i, 'SNARE', { prevGapMs: GAP / 2 }) : hit(i, 'SNARE', 0, { prevGapMs: GAP }));
  }

  it('2단계부터 DENSE가 나온다', () => {
    expect(causes(input(notes, { stage: 2 }))).toEqual(['DENSE']);
  });

  it('곡의 간격 중앙값이 없으면 계산하지 않는다', () => {
    expect(causes(input(notes, { noteGapMedianMs: null }))).toEqual([]);
  });

  it('보통 간격에서 놓치면 DENSE가 아니다', () => {
    const slow = notes.map((n) => (n.judgement === 'MISS' ? { ...n, prevGapMs: GAP } : n));
    expect(causes(input(slow))).not.toContain('DENSE');
  });
});

describe('놓침 원인: 다른 패드', () => {
  const notes: JudgedNote[] = [];
  const strays: StrayHit[] = [];
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 1) {
      notes.push(miss(i, 'SMALL_TOM'));
      strays.push({ pad: 'MID_TOM', songTimeMs: at(i) + 15 });
    } else {
      notes.push(hit(i, 'SNARE'));
    }
  }

  it('놓친 노트 근처에 다른 패드 타격이 있으면 WRONG_PAD와 대신 친 패드가 나온다', () => {
    const [c] = missCauses(input(notes, { strays, stage: 2 }));
    expect(c).toMatchObject({ cause: 'WRONG_PAD', pad: 'SMALL_TOM', intoPad: 'MID_TOM' });
  });

  it('타격이 멀리 떨어져 있거나 같은 패드면 WRONG_PAD가 아니다', () => {
    const far = strays.map((s) => ({ ...s, songTimeMs: s.songTimeMs + 250 }));
    expect(causes(input(notes, { strays: far }))).not.toContain('WRONG_PAD');
    const same = strays.map((s) => ({ ...s, pad: 'SMALL_TOM' as PadId }));
    expect(causes(input(notes, { strays: same }))).not.toContain('WRONG_PAD');
  });
});

describe('놓침 원인: 늦어지다 놓침', () => {
  // 점점 늦어지다 놓치고, 다시 맞춘다
  const notes: JudgedNote[] = [];
  let i = 0;
  for (let k = 0; k < 3; k++) {
    notes.push(hit(i++, 'SNARE', 5), hit(i++, 'SNARE', 15), hit(i++, 'SNARE', 30), miss(i++, 'SNARE'), miss(i++, 'SNARE'));
  }

  it('놓침 직전 오차가 점점 늦어지면 DRIFT_LATE가 나온다', () => {
    expect(causes(input(notes.slice(-16)))).toContain('DRIFT_LATE');
  });

  it('직전 오차가 고르면 DRIFT_LATE가 아니다', () => {
    const flat = notes.map((n) => (n.judgement === 'MISS' ? n : { ...n, deltaMs: 5, songTimeMs: n.noteTimeMs + 5 }));
    expect(causes(input(flat))).not.toContain('DRIFT_LATE');
  });

  it('판정이 노트 순서와 다르게 들어와도 노트 시각 순으로 본다', () => {
    const shuffled = [...notes].reverse();
    expect(causes(input(shuffled))).toContain('DRIFT_LATE');
  });
});

describe('단계와 고르기', () => {
  const notes = [hit(0, 'SNARE'), miss(1, 'SNARE', { prevGapMs: GAP / 2 }), miss(2, 'SNARE', { prevGapMs: GAP / 2 })];

  it('0·1단계에서는 원인을 계산하지 않는다', () => {
    expect(missCauses(input(notes, { stage: 0 }))).toEqual([]);
    expect(missCauses(input(notes, { stage: 1 }))).toEqual([]);
  });

  it('놓침이 하나뿐이면 원인을 말하지 않는다', () => {
    expect(missCauses(input(notes.slice(0, 2)))).toEqual([]);
  });

  it('대상 패드를 주면 그 패드의 놓침만 본다', () => {
    expect(missCauses(input(notes, { pad: 'SMALL_TOM' }))).toEqual([]);
    expect(causes(input(notes, { pad: 'SNARE' }))).toEqual(['DENSE']);
  });

  it('후보가 여럿이면 규칙 순서(다른 패드 → 패드 이동 → 빠른 구간 → 늦어짐)로 고르고, 없으면 UNKNOWN', () => {
    const dense = { cause: 'DENSE' as const, strength: 1, pad: null };
    const wrong = { cause: 'WRONG_PAD' as const, strength: 0.5, pad: null };
    expect(pickCauseByRule([dense, wrong]).cause).toBe('WRONG_PAD');
    expect(pickCauseByRule([])).toBe(UNKNOWN_CAUSE);
  });
});
