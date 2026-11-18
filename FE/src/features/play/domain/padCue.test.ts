// padCues 테스트: 패드별 다음 박 라벨과 next/later 단계
import { describe, expect, it } from 'vitest';
import type { NoteState } from '@/engine/RhythmSession';
import type { Chart } from '@/domain/song/chart';
import type { Judgement } from '@/domain/play/judgement';
import { cueLabelText, nextBeatBadges, NOW_TOLERANCE_MS, padCues, type PadCue } from './padCue';
import { buildSheet } from '@/domain/song/sheet';

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

  it('offGrid는 대상 칸의 값을 그대로 옮긴다', () => {
    expect(byPad(padCues(sheet, 0, states())).HIHAT.offGrid).toBe(false);
    // 1박 +50ms(0.4칸) → 라벨은 1, offGrid
    const off: Chart = { ...chart, notes: [{ timeMs: 50, pad: 'SNARE' }, { timeMs: 500, pad: 'KICK' }] };
    const cues = byPad(padCues(buildSheet(off), 0, off.notes.map((note, index) => ({ index, note, judgement: null, deltaMs: null, hitId: null }))));
    expect(cues.SNARE).toMatchObject({ label: { beat: 1, sub: '' }, offGrid: true, level: 'next' });
    expect(cues.KICK.offGrid).toBe(false);
  });

  it('마디가 바뀌면 그 마디 기준으로 계산한다', () => {
    const cues = padCues(sheet, 1, states());
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ pad: 'HIHAT', noteIndex: 6, level: 'next', label: { beat: 1, sub: '' } });
  });
});

describe('cueLabelText', () => {
  it('박 번호 + 박 안 위치(1·1e·1&·1a)', () => {
    expect(cueLabelText({ beat: 1, sub: '' })).toBe('1');
    expect(cueLabelText({ beat: 1, sub: 'e' })).toBe('1e');
    expect(cueLabelText({ beat: 1, sub: '&' })).toBe('1&');
    expect(cueLabelText({ beat: 4, sub: 'a' })).toBe('4a');
  });
});

describe('nextBeatBadges', () => {
  const cue = (over: Partial<PadCue>): PadCue => ({
    pad: 'SNARE',
    label: { beat: 1, sub: '' },
    noteIndex: 0,
    timeMs: 1000,
    level: 'next',
    offGrid: false,
    ...over,
  });

  it('곡 시각이 칠 시각 ±17ms 안이면 now, 밖이면 큐의 next·later를 그대로 쓴다', () => {
    const cues = [
      cue({ pad: 'SNARE', timeMs: 1000, level: 'next' }),
      cue({ pad: 'KICK', timeMs: 1017, level: 'later' }),
      cue({ pad: 'HIHAT', timeMs: 1018, level: 'later' }),
      cue({ pad: 'CRASH', timeMs: 983, level: 'next' }),
      cue({ pad: 'RIDE', timeMs: 982, level: 'next' }),
    ];
    const { badges, nowPads } = nextBeatBadges(cues, 1000);
    expect(NOW_TOLERANCE_MS).toBe(17);
    expect(badges.SNARE?.level).toBe('now');
    expect(badges.KICK?.level).toBe('now'); // 경계 포함
    expect(badges.CRASH?.level).toBe('now');
    expect(badges.HIHAT?.level).toBe('later');
    expect(badges.RIDE?.level).toBe('next');
    expect(nowPads).toEqual(['SNARE', 'KICK', 'CRASH']);
  });

  it('now가 없으면 nowPads는 비고 level은 큐 그대로', () => {
    const r = nextBeatBadges([cue({ pad: 'SNARE', level: 'next' }), cue({ pad: 'KICK', level: 'later', timeMs: 1500 })], 0);
    expect(r.nowPads).toEqual([]);
    expect(r.badges.SNARE?.level).toBe('next');
    expect(r.badges.KICK?.level).toBe('later');
  });

  it('배지 text는 cueLabelText, offGrid는 그대로 전달', () => {
    const r = nextBeatBadges(
      [cue({ pad: 'SNARE', label: { beat: 2, sub: '&' }, offGrid: true }), cue({ pad: 'KICK', label: { beat: 3, sub: 'a' }, offGrid: false })],
      0,
    );
    expect(r.badges.SNARE).toEqual({ text: '2&', level: 'next', offGrid: true });
    expect(r.badges.KICK).toEqual({ text: '3a', level: 'next', offGrid: false });
  });

  it('highlight: now 패드가 있으면 첫 now, 없으면 가장 먼저 칠 next 패드', () => {
    const cues = [cue({ pad: 'KICK', level: 'later', timeMs: 500 }), cue({ pad: 'SNARE', level: 'next', timeMs: 1000 })];
    expect(nextBeatBadges(cues, 500).highlight).toBe('KICK');
    expect(nextBeatBadges(cues, 0).highlight).toBe('SNARE');
  });

  it('큐가 없으면 빈 결과', () => {
    const r = nextBeatBadges([], 0);
    expect(r.badges).toEqual({});
    expect(r.nowPads).toEqual([]);
    expect(r.highlight).toBeUndefined();
  });

  it('padCues와 이어 쓰기: 동시타는 둘 다 now', () => {
    const r = nextBeatBadges(padCues(sheet, 0, states()), 0);
    expect([...r.nowPads].sort()).toEqual(['HIHAT', 'KICK']);
    expect(r.badges.MID_TOM).toMatchObject({ text: '2', level: 'later' });
    expect(r.badges.SNARE).toMatchObject({ text: '3', level: 'later' });
  });
});
