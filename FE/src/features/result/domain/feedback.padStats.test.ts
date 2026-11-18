import { describe, expect, it } from 'vitest';
import { summarizeByPad } from './feedback';
import type { Judgement } from '@/domain/play/judgement';
import type { PadId } from '@/domain/kit/pads';
import type { LoggedHit, LogNote, PlayLog } from '@/domain/play/playLog';

const note = (index: number, pad: PadId, judgement: Judgement | null, deltaMs: number | null = null): LogNote => ({
  index,
  timeMs: index * 500,
  pad,
  judgement,
  deltaMs,
});

const hit = (hitId: number, velocity: number, matchedNoteIndex?: number, judgement: Judgement | null = 'PERFECT'): LoggedHit => ({
  hitId,
  stickId: 0,
  pad: 'SNARE',
  velocity,
  tHit: 0,
  tRecv: 0,
  tResolved: 0,
  judgement: judgement ?? undefined,
  matchedNoteIndex,
});

function logOf(notes: LogNote[], hits?: LoggedHit[]): PlayLog {
  return {
    playId: 'p',
    songId: 't',
    title: 't',
    difficulty: 'EASY',
    mode: 'RHYTHM',
    inputSource: 'STICK',
    startedAt: '2026-11-01T00:00:00.000Z',
    durationMs: 10_000,
    timing: { perfectMs: 25, goodMs: 60 },
    calibrationId: null,
    chartVersionId: null,
    songNumericId: null,
    chartId: null,
    presetId: null,
    bpm: 120,
    beatsPerBar: 4,
    hits: hits as LoggedHit[],
    notes,
    summary: { score: 0, maxScore: 0, accuracy: 0, maxCombo: 0, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0 },
  } as PlayLog;
}

describe('summarizeByPad 패드 정확도', () => {
  it('PERFECT·GOOD·MISS가 섞이면 점수 평균(100·80·0, 330번)으로 계산한다', () => {
    const s = summarizeByPad(logOf([note(0, 'SNARE', 'PERFECT', 0), note(1, 'SNARE', 'GOOD', 40), note(2, 'SNARE', 'MISS')]));
    expect(s).toHaveLength(1);
    expect(s[0].accuracy).toBeCloseTo((100 + 80 + 0) / 300, 10);
  });

  it('전부 PERFECT면 1, 전부 MISS면 0', () => {
    const all = summarizeByPad(logOf([note(0, 'KICK', 'PERFECT', 1), note(1, 'KICK', 'PERFECT', -1)]));
    expect(all[0].accuracy).toBe(1);
    const none = summarizeByPad(logOf([note(0, 'KICK', 'MISS'), note(1, 'KICK', 'MISS')]));
    expect(none[0].accuracy).toBe(0);
  });

  it('판정 전 노트(judgement null)는 분모에서 빠진다', () => {
    const s = summarizeByPad(logOf([note(0, 'SNARE', 'PERFECT', 0), note(1, 'SNARE', null), note(2, 'SNARE', null)]));
    expect(s[0].total).toBe(1);
    expect(s[0].accuracy).toBe(1);
  });

  it('판정된 노트가 없는 패드는 목록에서 빠진다', () => {
    expect(summarizeByPad(logOf([note(0, 'SNARE', null)]))).toEqual([]);
  });

  it('패드별로 따로 계산한다', () => {
    const s = summarizeByPad(logOf([note(0, 'SNARE', 'PERFECT', 0), note(1, 'KICK', 'MISS')]));
    const by = Object.fromEntries(s.map((x) => [x.pad, x.accuracy]));
    expect(by.SNARE).toBe(1);
    expect(by.KICK).toBe(0);
  });
});

describe('summarizeByPad meanVelocity', () => {
  const notes = [note(0, 'SNARE', 'PERFECT', 0), note(1, 'SNARE', 'GOOD', 30), note(2, 'KICK', 'PERFECT', 0)];

  it('matchedNoteIndex로 매칭된 타격 velocity 평균을 0~100으로 반올림한다', () => {
    // (127 + 64) / 2 = 95.5 → 95.5 / 127 * 100 = 75.19 → 75
    const s = summarizeByPad(logOf(notes, [hit(1, 127, 0), hit(2, 64, 1)]));
    expect(s.find((x) => x.pad === 'SNARE')?.meanVelocity).toBe(75);
  });

  it('최대 127은 100, 최소 1은 1', () => {
    expect(summarizeByPad(logOf(notes, [hit(1, 127, 0)]))[0].meanVelocity).toBe(100);
    expect(summarizeByPad(logOf(notes, [hit(1, 1, 0)]))[0].meanVelocity).toBe(1);
  });

  it('매칭되지 않은 타격(matchedNoteIndex 없음·판정 없음)은 제외한다', () => {
    const s = summarizeByPad(logOf(notes, [hit(1, 127, 0), hit(2, 1), hit(3, 1, 1, null)]));
    expect(s.find((x) => x.pad === 'SNARE')?.meanVelocity).toBe(100);
  });

  it('다른 패드 노트에 매칭된 타격은 제외한다', () => {
    const s = summarizeByPad(logOf(notes, [hit(1, 127, 0), hit(2, 1, 2)]));
    expect(s.find((x) => x.pad === 'SNARE')?.meanVelocity).toBe(100);
    expect(s.find((x) => x.pad === 'KICK')?.meanVelocity).toBe(1);
  });

  it('존재하지 않는 노트 위치를 가리키는 타격은 무시한다', () => {
    const s = summarizeByPad(logOf(notes, [hit(1, 127, 99)]));
    expect(s.every((x) => x.meanVelocity === null)).toBe(true);
  });

  it('hits가 없거나 비어 있으면 null', () => {
    expect(summarizeByPad(logOf(notes, undefined)).every((x) => x.meanVelocity === null)).toBe(true);
    expect(summarizeByPad(logOf(notes, [])).every((x) => x.meanVelocity === null)).toBe(true);
  });

  it('매칭된 타격이 없는 패드만 null', () => {
    const s = summarizeByPad(logOf(notes, [hit(1, 127, 0)]));
    expect(s.find((x) => x.pad === 'SNARE')?.meanVelocity).toBe(100);
    expect(s.find((x) => x.pad === 'KICK')?.meanVelocity).toBeNull();
  });
});
