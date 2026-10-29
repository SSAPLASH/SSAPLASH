// padCues 테스트: 패드별 다음 박 라벨과 next/later 단계
import { describe, expect, it } from 'vitest';
import type { NoteState } from '@/engine/RhythmSession';
import type { Chart } from './chart';
import type { Judgement } from './judgement';
import { padCues, type PadCue } from './padCue';
import { buildSheet } from './sheet';

// 120 BPM 4/4: 칸 125ms, 마디 2000ms
const notes: Chart['notes'] = [
  { timeMs: 0, pad: 'HIHAT' }, // 0: 1
  { timeMs: 0, pad: 'KICK' }, // 1: 1 (동시타)
  { timeMs: 250, pad: 'HIHAT' }, // 2: 1&
  { timeMs: 500, pad: 'MID_TOM' }, // 3: 2
  { timeMs: 1000, pad: 'SNARE' }, // 4: 3
  { timeMs: 1125, pad: 'HIHAT' }, // 5: 3e
  { timeMs: 2000, pad: 'HIHAT' }, // 6: 다음 마디 1
];
const chart: Chart = { songId: 't', title: 't', difficulty: 'EASY', bpm: 120, offsetMs: 0, beatsPerBar: 4, notes, source: 'BUILTIN', durationMs: 4000 };
const sheet = buildSheet(chart);

function states(judged: Record<number, Judgement> = {}): NoteState[] {
  return notes.map((note, index) => ({ index, note, judgement: judged[index] ?? null, deltaMs: null, hitId: null }));
}
const byPad = (cues: PadCue[]) => Object.fromEntries(cues.map((c) => [c.pad, c]));

describe('padCues', () => {
  it('패드마다 가장 이른 미판정 칸 하나를 고른다', () => {
    const cues = byPad(padCues(sheet, 0, states()));
    expect(Object.keys(cues).sort()).toEqual(['HIHAT', 'KICK', 'MID_TOM', 'SNARE']);
    expect(cues.HIHAT.noteIndex).toBe(0);
    expect(cues.HIHAT.label).toEqual({ beat: 1, sub: '' });
    expect(cues.MID_TOM.label).toEqual({ beat: 2, sub: '' });
    expect(cues.SNARE.timeMs).toBe(1000);
  });

  it('동시타 패드는 모두 next, 나머지는 later', () => {
    const cues = byPad(padCues(sheet, 0, states()));
    expect(cues.HIHAT.level).toBe('next');
    expect(cues.KICK.level).toBe('next');
    expect(cues.MID_TOM.level).toBe('later');
    expect(cues.SNARE.level).toBe('later');
  });

  it('판정된 음은 건너뛰고 다음 라벨을 낸다', () => {
    const cues = byPad(padCues(sheet, 0, states({ 0: 'PERFECT', 1: 'MISS' })));
    expect(cues.HIHAT.label).toEqual({ beat: 1, sub: '&' });
    expect(cues.HIHAT.level).toBe('next');
    expect(cues.KICK).toBeUndefined();
    expect(cues.MID_TOM.level).toBe('later');
  });

  it('next는 남은 음 중 가장 이른 칸으로 옮겨 간다', () => {
    const cues = byPad(padCues(sheet, 0, states({ 0: 'GOOD', 1: 'GOOD', 2: 'GOOD' })));
    expect(cues.MID_TOM.level).toBe('next');
    expect(cues.SNARE.level).toBe('later');
    expect(cues.HIHAT.label).toEqual({ beat: 3, sub: 'e' });
  });

  it('남은 음이 없으면 큐가 없다', () => {
    const all = Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [i, 'PERFECT' as Judgement]));
    expect(padCues(sheet, 0, states(all))).toEqual([]);
  });

  it('범위 밖 마디는 빈 배열이다', () => {
    expect(padCues(sheet, -1, states())).toEqual([]);
    expect(padCues(sheet, 99, states())).toEqual([]);
  });

  it('마디가 바뀌면 그 마디 기준으로 계산한다', () => {
    const cues = padCues(sheet, 1, states());
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ pad: 'HIHAT', noteIndex: 6, level: 'next', label: { beat: 1, sub: '' } });
  });
});
