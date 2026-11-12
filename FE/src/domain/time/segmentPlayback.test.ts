import { describe, expect, it } from 'vitest';
import type { ReportNote } from '../report';
import { SEGMENT_NOTE_VELOCITY, planSegment } from './segmentPlayback';

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
