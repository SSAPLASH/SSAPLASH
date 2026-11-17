import { describe, expect, it } from 'vitest';
import type { ReportNote } from '@/domain/play/report';
import type { LoggedHit, LogNote } from '@/domain/play/playLog';
import { SEGMENT_NOTE_VELOCITY, planPlayed, planSegment, playedHitsFromLog, playedHitsFromNotes, type PlayedHit } from './segmentPlayback';

function note(timeMs: number, pad: ReportNote['pad'] = 'KICK', judgement: ReportNote['judgement'] = 'PERFECT'): ReportNote {
  return { seq: 0, noteId: null, timeMs, pad, judgement, deltaMs: null, velocity: null };
}

describe('planSegment', () => {
  it('시작은 포함하고 끝은 포함하지 않는다', () => {
    const p = planSegment([note(999), note(1000), note(1500), note(2000)], 1000, 2000, 1);
    expect(p.events.map((e) => e.atMs)).toEqual([0, 500]);
    expect(p.lengthMs).toBe(1000);
    expect(p.fromMs).toBe(1000);
    expect(p.toMs).toBe(2000);
  });

  it('시간순으로 정렬하고 velocity를 고정한다', () => {
    const p = planSegment([note(1800, 'SNARE'), note(1200, 'KICK')], 1000, 2000, 1);
    expect(p.events.map((e) => e.pad)).toEqual(['KICK', 'SNARE']);
    expect(p.events.every((e) => e.velocity === SEGMENT_NOTE_VELOCITY)).toBe(true);
  });

  it('MISS 노트도 포함한다', () => {
    const p = planSegment([note(1100, 'KICK', 'MISS')], 1000, 2000, 1);
    expect(p.events).toHaveLength(1);
  });

  it('rate 0.75면 시각과 길이가 1/0.75배', () => {
    const p = planSegment([note(1750)], 1000, 2000, 0.75);
    expect(p.events[0].atMs).toBeCloseTo(1000);
    expect(p.lengthMs).toBeCloseTo(1000 / 0.75);
  });

  it('rate가 0·NaN·음수면 1로 본다', () => {
    for (const r of [0, NaN, -1, Infinity]) {
      const p = planSegment([note(1500)], 1000, 2000, r);
      expect(p.events[0].atMs).toBe(500);
      expect(p.lengthMs).toBe(1000);
    }
  });

  it('구간 안 노트가 없으면 빈 목록', () => {
    const p = planSegment([note(10)], 1000, 2000, 1);
    expect(p.events).toEqual([]);
    expect(p.lengthMs).toBe(1000);
  });
});

const lhit = (over: Partial<LoggedHit>): LoggedHit => ({ hitId: 0, stickId: 0, pad: 'SNARE', velocity: 100, tHit: 0, tRecv: 0, tResolved: 0, ...over });
const lnote = (index: number, timeMs: number): LogNote => ({ index, timeMs, pad: 'SNARE', judgement: 'PERFECT', deltaMs: 0 });

describe('playedHitsFromLog', () => {
  it('판정 타격은 노트 시각 + 오차 × 배율, 기준 시각은 노트 시각', () => {
    const notes = [lnote(0, 1000)];
    const hits = [lhit({ judgement: 'GOOD', matchedNoteIndex: 0, deltaMs: -40 })];
    expect(playedHitsFromLog({ hits, notes, playbackRate: 1 })).toEqual([{ timeMs: 960, anchorMs: 1000, pad: 'SNARE', velocity: 100 }]);
    expect(playedHitsFromLog({ hits, notes, playbackRate: 0.75 })[0].timeMs).toBeCloseTo(970);
  });

  it('헛친 타격은 tSongMs를 쓰고, 패드 없음·tSongMs 없음은 제외', () => {
    const hits = [lhit({ tSongMs: 500 }), lhit({ pad: null, tSongMs: 600 }), lhit({}), lhit({ tSongMs: NaN }), lhit({ tSongMs: -1 })];
    expect(playedHitsFromLog({ hits, notes: [] })).toEqual([{ timeMs: 500, anchorMs: 500, pad: 'SNARE', velocity: 100 }]);
  });

  it('세기는 반올림해 1~127로 자르고 시각순으로 정렬한다', () => {
    const hits = [lhit({ tSongMs: 900, velocity: 300 }), lhit({ tSongMs: 100, velocity: 0.2 }), lhit({ tSongMs: 500, velocity: 64.6 })];
    const r = playedHitsFromLog({ hits, notes: [], playbackRate: 0 });
    expect(r.map((h) => h.timeMs)).toEqual([100, 500, 900]);
    expect(r.map((h) => h.velocity)).toEqual([1, 65, 127]);
  });

  it('짝지어진 노트가 없으면 tSongMs로 폴백한다', () => {
    const hits = [lhit({ judgement: 'GOOD', matchedNoteIndex: 5, deltaMs: 10, tSongMs: 700 })];
    expect(playedHitsFromLog({ hits, notes: [lnote(0, 1000)] })[0]).toMatchObject({ timeMs: 700, anchorMs: 700 });
  });
});

describe('playedHitsFromNotes', () => {
  const rn = (timeMs: number, judgement: ReportNote['judgement'], deltaMs: number | null, velocity: number | null = null): ReportNote => ({
    seq: 0,
    noteId: null,
    timeMs,
    pad: 'KICK',
    judgement,
    deltaMs,
    velocity,
  });

  it('MISS·오차 없는 노트는 제외하고 세기가 없으면 90', () => {
    const r = playedHitsFromNotes([rn(1000, 'MISS', null), rn(2000, 'GOOD', null), rn(3000, 'PERFECT', 5)], 1);
    expect(r).toEqual([{ timeMs: 3005, anchorMs: 3000, pad: 'KICK', velocity: 90 }]);
  });

  it('배율을 오차에 곱하고 기록된 세기를 쓴다', () => {
    const r = playedHitsFromNotes([rn(1000, 'GOOD', -40, 50)], 0.75);
    expect(r[0].timeMs).toBeCloseTo(970);
    expect(r[0].velocity).toBe(50);
  });
});

describe('planPlayed', () => {
  const ph = (timeMs: number, anchorMs = timeMs): PlayedHit => ({ timeMs, anchorMs, pad: 'SNARE', velocity: 80 });

  it('기준 시각으로 소속을 정하고, 일찍 친 첫 타격이 재생 시작을 당긴다', () => {
    const p = planPlayed([ph(970, 1000), ph(1500)], 1000, 2000, 1);
    expect(p.fromMs).toBe(970);
    expect(p.toMs).toBe(2000);
    expect(p.events.map((e) => e.atMs)).toEqual([0, 530]);
    expect(p.lengthMs).toBe(1030);
  });

  it('늦게 친 마지막 타격이 재생 끝을 늘린다', () => {
    const p = planPlayed([ph(2040, 1990)], 1000, 2000, 1);
    expect(p.toMs).toBe(2040);
    expect(p.fromMs).toBe(1000);
  });

  it('기준 시각이 구간 밖이면 제외한다(끝은 미포함)', () => {
    expect(planPlayed([ph(990), ph(2000)], 1000, 2000, 1).events).toEqual([]);
  });

  it('0.75배면 atMs·lengthMs가 1/0.75배, 잘못된 배속은 1', () => {
    const p = planPlayed([ph(1750)], 1000, 2000, 0.75);
    expect(p.events[0].atMs).toBeCloseTo(1000);
    expect(p.lengthMs).toBeCloseTo(1000 / 0.75);
    expect(planPlayed([ph(1500)], 1000, 2000, NaN).events[0].atMs).toBe(500);
  });

  it('빈 결과는 구간 그대로', () => {
    expect(planPlayed([], 1000, 2000, 1)).toEqual({ events: [], lengthMs: 1000, fromMs: 1000, toMs: 2000 });
  });
});
