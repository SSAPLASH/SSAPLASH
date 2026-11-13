import { describe, expect, it } from 'vitest';
import type { NoteState } from '@/engine/RhythmSession';
import type { PadId } from '@/domain/kit/pads';
import type { Judgement } from '@/domain/play/judgement';
import { chordGroups, nextTargets, visibleNotes } from './kitPlayDraw';

function note(index: number, timeMs: number, pad: PadId, judgement: Judgement | null = null): NoteState {
  return { index, note: { timeMs, pad } as NoteState['note'], judgement, deltaMs: null, hitId: null };
}

describe('visibleNotes', () => {
  it('진행도: scrollMs 앞에서 0, 판정 시각에 1', () => {
    const notes = [note(0, 2000, 'SNARE')];
    expect(visibleNotes(notes, 600, 1400)[0].progress).toBeCloseTo(0);
    expect(visibleNotes(notes, 1300, 1400)[0].progress).toBeCloseTo(0.5);
    expect(visibleNotes(notes, 2000, 1400)[0].progress).toBeCloseTo(1);
  });

  it('scrollMs 밖(먼 미래)·한참 지난 미판정 노트는 제외', () => {
    const notes = [note(0, 500, 'SNARE'), note(1, 5000, 'SNARE')];
    expect(visibleNotes(notes, 2000, 1400)).toHaveLength(0);
  });

  it('같은 패드는 가까운 4개까지만', () => {
    const notes = [0, 1, 2, 3, 4, 5].map((i) => note(i, 1000 + i * 100, 'SNARE'));
    const out = visibleNotes(notes, 1000, 1400);
    expect(out.map((o) => o.index)).toEqual([0, 1, 2, 3]);
  });

  it('상한은 패드별로 센다', () => {
    const notes = [note(0, 1000, 'SNARE'), note(1, 1010, 'KICK'), note(2, 1020, 'SNARE')];
    expect(visibleNotes(notes, 900, 1400, 1).map((o) => o.index)).toEqual([0, 1]);
  });

  it('MISS는 판정 뒤 150ms만 남고, 일반 타격 노트는 그리지 않는다', () => {
    const notes = [note(0, 1000, 'SNARE', 'MISS'), note(1, 1000, 'KICK', 'PERFECT')];
    expect(visibleNotes(notes, 1000 + 120 + 50, 1400)).toMatchObject([{ index: 0, judged: 'MISS', progress: 1 }]);
    expect(visibleNotes(notes, 1000 + 120 + 200, 1400)).toHaveLength(0);
  });
});

describe('chordGroups', () => {
  it('같은 시각 노트의 패드를 묶고 단독 노트는 뺀다', () => {
    const notes = [note(0, 1000, 'SNARE'), note(1, 1000, 'KICK'), note(2, 1100, 'HIHAT')];
    const g = chordGroups(notes, 1000, 20);
    expect(g).toHaveLength(1);
    expect(g[0].sort()).toEqual(['KICK', 'SNARE']);
  });

  it('허용 오차 밖이거나 이미 판정된 노트는 무시', () => {
    const notes = [note(0, 1000, 'SNARE'), note(1, 1000, 'KICK', 'PERFECT')];
    expect(chordGroups(notes, 1000, 20)).toHaveLength(0);
    expect(chordGroups([note(0, 1000, 'SNARE'), note(1, 1000, 'KICK')], 1500, 20)).toHaveLength(0);
  });
});

describe('nextTargets', () => {
  it('가장 가까운 미판정 노트와 같은 시각의 패드', () => {
    const notes = [note(0, 900, 'SMALL_TOM', 'PERFECT'), note(1, 1000, 'SNARE'), note(2, 1000, 'KICK'), note(3, 1100, 'SNARE')];
    expect(nextTargets(notes, 950).sort()).toEqual(['KICK', 'SNARE']);
  });
});
