// 리듬 게임 세션(설계 4-2 판정 절차) 규칙 검증. 가짜 시각(ms)만 넣고 performance.now는 쓰지 않는다.
import { describe, expect, it } from 'vitest';
import { RhythmSession, type RhythmOptions } from './RhythmSession';
import type { Chart, ChartNote } from '@/domain/chart';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/pads';

const OPTS: RhythmOptions = { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 1, audioOffsetMs: 0 };

/** 120BPM(박 500ms, 1마디 2000ms) 테스트 채보 */
function chart(notes: ChartNote[], durationMs = 2500): Chart {
  return {
    songId: 't',
    title: '테스트',
    difficulty: 'EASY',
    bpm: 120,
    offsetMs: 0,
    beatsPerBar: 4,
    notes,
    source: 'BUILTIN',
    durationMs,
  };
}

const NOTES: ChartNote[] = [
  { timeMs: 1000, pad: 'SNARE' },
  { timeMs: 1000, pad: 'HIHAT' },
  { timeMs: 1100, pad: 'SNARE' },
  { timeMs: 1500, pad: 'KICK' },
  { timeMs: 2000, pad: 'CRASH' },
];

let seq = 0;
function hit(pad: PadId | null, tHit: number): ResolvedHit {
  return {
    id: ++seq,
    stickId: 0,
    pad,
    velocity: 100,
    tHit,
    tRecv: tHit,
    tResolved: tHit,
    source: 'keyboard',
    pose: { pitch: 0, yaw: 0 },
    peakAccel: 5,
    judgedBy: 'key',
  };
}

/** start(12000): 곡 0ms = 12000, 카운트인은 10000부터. 곡 시각 t ↔ now = 12000 + t */
const T0 = 12000;
function playing(notes = NOTES, opts = OPTS): RhythmSession {
  const s = new RhythmSession(chart(notes), opts);
  s.start(12000);
  s.tick(T0);
  return s;
}

describe('시작·카운트인', () => {
  it('idle일 때 곡 시각은 −카운트인으로 고정된다', () => {
    const s = new RhythmSession(chart(NOTES), OPTS);
    expect(s.countInMs).toBe(2000);
    expect(s.songTime(5000)).toBe(-2000);
    expect(s.songTime(99999)).toBe(-2000);
  });

  it('start 후 카운트인, 곡 0ms부터 playing', () => {
    const s = new RhythmSession(chart(NOTES), OPTS);
    s.start(12000);
    expect(s.currentStatus).toBe('countin');
    s.tick(11999);
    expect(s.currentStatus).toBe('countin');
    s.tick(T0);
    expect(s.currentStatus).toBe('playing');
    expect(s.songTime(T0 + 300)).toBe(300);
  });

  it('카운트인 박 시각은 start 시각부터 박 간격으로 4개, 첫 박 악센트', () => {
    const s = new RhythmSession(chart(NOTES), OPTS);
    s.start(12000);
    const beats = s.countInBeats();
    expect(beats.map((b) => b.at)).toEqual([10000, 10500, 11000, 11500]);
    expect(beats.map((b) => b.accent)).toEqual([true, false, false, false]);
  });

  it('offsetMs > 0이면 카운트인 박이 원점(1마디 1박) 직전 1마디에 놓인다', () => {
    // 원점 1250ms: 카운트인은 곡 시각 −750ms부터 4박, 마지막 박 다음 박이 1250ms
    const s = new RhythmSession({ ...chart(NOTES), offsetMs: 1250 }, OPTS);
    s.start(12000);
    expect(s.originMs).toBe(1250);
    expect(s.countInBeats().map((b) => b.at)).toEqual([11250, 11750, 12250, 12750]);
    // 곡 0ms·판정 기준은 그대로(원점과 무관)
    expect(s.songTime(T0 + 300)).toBe(300);
  });

  it('카운트인 중에도 창 안의 노트는 판정된다', () => {
    const s = new RhythmSession(chart([{ timeMs: 30, pad: 'RIDE' }]), OPTS);
    s.start(12000);
    const ev = s.handleHit(hit('RIDE', T0 - 10));
    expect(ev?.judgement).toBe('GOOD');
    expect(ev?.deltaMs).toBe(-40);
  });
});

describe('노트 배정과 판정', () => {
  it('같은 패드 노트가 여럿이면 가장 가까운 노트에 배정한다', () => {
    const s = playing();
    const ev = s.handleHit(hit('SNARE', T0 + 1060));
    expect(ev?.noteIndex).toBe(2);
    expect(ev?.deltaMs).toBe(-40);
    expect(ev?.judgement).toBe('GOOD');
  });

  it('Perfect 경계 ±25ms', () => {
    expect(playing().handleHit(hit('HIHAT', T0 + 1025))?.judgement).toBe('PERFECT');
    expect(playing().handleHit(hit('HIHAT', T0 + 1026))?.judgement).toBe('GOOD');
    expect(playing().handleHit(hit('HIHAT', T0 + 975))?.judgement).toBe('PERFECT');
  });

  it('Good 경계 ±60ms, 넘으면 채보 외 타격', () => {
    const s = playing();
    expect(s.handleHit(hit('KICK', T0 + 1560))?.judgement).toBe('GOOD');
    const s2 = playing();
    expect(s2.handleHit(hit('KICK', T0 + 1561))).toBeNull();
    expect(s2.snapshot(T0 + 1561).strayHits).toBe(1);
  });

  it('점수: Perfect 100, Good 60, 만점 = 노트 수 × 100', () => {
    const s = playing();
    s.handleHit(hit('HIHAT', T0 + 1000));
    s.handleHit(hit('SNARE', T0 + 1040));
    const snap = s.snapshot(T0 + 1100);
    expect(snap.score).toBe(160);
    expect(snap.maxScore).toBe(500);
    expect(snap.counts).toEqual({ PERFECT: 1, GOOD: 1, MISS: 0 });
    expect(snap.judgedCount).toBe(2);
  });

  it('오디오 오프셋은 타격 시각에서 뺀다', () => {
    const s = playing(NOTES, { ...OPTS, audioOffsetMs: 10 });
    const ev = s.handleHit(hit('HIHAT', T0 + 1010));
    expect(ev?.deltaMs).toBe(0);
  });

  it('채보에 없는 패드는 감점·콤보 영향 없이 채보 외 타격만 센다', () => {
    const s = playing();
    s.handleHit(hit('HIHAT', T0 + 1000));
    expect(s.handleHit(hit('RIDE', T0 + 1000))).toBeNull();
    const snap = s.snapshot(T0 + 1000);
    expect(snap.strayHits).toBe(1);
    expect(snap.score).toBe(100);
    expect(snap.combo).toBe(1);
  });

  it('pad가 없는 타격은 무시한다', () => {
    const s = playing();
    expect(s.handleHit(hit(null, T0 + 1000))).toBeNull();
    expect(s.snapshot(T0 + 1000).strayHits).toBe(0);
  });

  it('이미 판정된 노트에는 다시 배정하지 않는다', () => {
    const s = playing();
    s.handleHit(hit('HIHAT', T0 + 1000));
    expect(s.handleHit(hit('HIHAT', T0 + 1010))).toBeNull();
    expect(s.snapshot(T0 + 1010).strayHits).toBe(1);
  });
});

describe('Miss·콤보', () => {
  it('노트 시각 + goodMs가 지나면 tick이 Miss 처리하고 콤보를 끊는다', () => {
    const s = playing();
    const events: string[] = [];
    s.onJudgement((e) => events.push(`${e.judgement}:${e.noteIndex}`));
    s.handleHit(hit('HIHAT', T0 + 1000));
    s.tick(T0 + 1060);
    expect(s.snapshot(T0 + 1060).counts.MISS).toBe(0);
    s.tick(T0 + 1061);
    const snap = s.snapshot(T0 + 1061);
    expect(snap.counts.MISS).toBe(1);
    expect(snap.combo).toBe(0);
    expect(snap.maxCombo).toBe(1);
    expect(events).toEqual(['PERFECT:1', 'MISS:0']);
    expect(s.notes[0].judgement).toBe('MISS');
    expect(s.notes[0].deltaMs).toBeNull();
  });

  it('연속 성공은 콤보가 쌓이고 maxCombo가 남는다', () => {
    const s = playing();
    s.handleHit(hit('SNARE', T0 + 1000));
    s.handleHit(hit('HIHAT', T0 + 1000));
    s.handleHit(hit('SNARE', T0 + 1100));
    expect(s.snapshot(T0 + 1100).combo).toBe(3);
    s.tick(T0 + 1561); // KICK@1500 Miss
    expect(s.snapshot(T0 + 1561).combo).toBe(0);
    expect(s.snapshot(T0 + 1561).maxCombo).toBe(3);
  });
});

describe('후보 제한 (센서 판정용)', () => {
  it('±2×goodMs 안의 미판정 노트 패드만 돌려준다', () => {
    const s = playing();
    expect(s.candidates(T0 + 1000)?.sort()).toEqual(['HIHAT', 'SNARE']);
    expect(s.candidates(T0 + 1500)).toEqual(['KICK']);
    expect(s.candidates(T0 + 5000)).toBeUndefined();
  });

  it('판정된 노트는 후보에서 빠진다', () => {
    const s = playing();
    s.handleHit(hit('HIHAT', T0 + 1000));
    expect(s.candidates(T0 + 1000)).toEqual(['SNARE']);
  });

  it('idle·finished에서는 undefined', () => {
    const s = new RhythmSession(chart(NOTES), OPTS);
    expect(s.candidates(T0 + 1000)).toBeUndefined();
  });
});

describe('종료', () => {
  it('곡 길이 + 0.8초가 지나면 finished, 남은 노트는 Miss', () => {
    const s = playing();
    s.tick(T0 + 3300);
    expect(s.currentStatus).toBe('playing');
    s.tick(T0 + 3301);
    expect(s.currentStatus).toBe('finished');
    expect(s.snapshot(T0 + 3301).counts.MISS).toBe(5);
    expect(s.handleHit(hit('SNARE', T0 + 3301))).toBeNull();
  });
});

describe('일시정지 (중단 확인 팝업)', () => {
  it('멈춘 동안 곡 시각이 고정되고 Miss·판정이 없다', () => {
    const s = playing();
    s.pause(T0 + 500);
    expect(s.currentStatus).toBe('paused');
    expect(s.songTime(T0 + 5000)).toBe(500);
    s.tick(T0 + 5000);
    expect(s.snapshot(T0 + 5000).counts.MISS).toBe(0);
    expect(s.handleHit(hit('HIHAT', T0 + 5000))).toBeNull();
    expect(s.snapshot(T0 + 5000).strayHits).toBe(0);
  });

  it('재개하면 멈춘 만큼 밀려 이어진다', () => {
    const s = playing();
    s.pause(T0 + 500);
    s.resume(T0 + 1500); // 1000ms 멈춤
    expect(s.currentStatus).toBe('playing');
    expect(s.songTime(T0 + 1500)).toBe(500);
    const ev = s.handleHit(hit('HIHAT', T0 + 2000)); // 곡 시각 1000
    expect(ev?.judgement).toBe('PERFECT');
    expect(ev?.deltaMs).toBe(0);
  });

  it('카운트인 중 멈추면 재개 후 카운트인으로 돌아간다', () => {
    const s = new RhythmSession(chart(NOTES), OPTS);
    s.start(12000);
    s.pause(11000);
    s.resume(12000);
    expect(s.currentStatus).toBe('countin');
    expect(s.songTime(12000)).toBe(-1000);
  });

  it('idle·finished에서는 pause가 무시되고, paused가 아니면 resume이 무시된다', () => {
    const s = new RhythmSession(chart(NOTES), OPTS);
    s.pause(100);
    expect(s.currentStatus).toBe('idle');
    const p = playing();
    p.resume(T0 + 100);
    expect(p.songTime(T0 + 100)).toBe(100);
  });
});

describe('reset', () => {
  it('판정·점수·시계를 비우고 idle로 돌아간다', () => {
    const s = playing();
    s.handleHit(hit('SNARE', T0 + 1000));
    expect(s.snapshot(T0 + 1000).judgedCount).toBe(1);
    s.reset();
    expect(s.currentStatus).toBe('idle');
    expect(s.snapshot().judgedCount).toBe(0);
    expect(s.notes.every((n) => n.judgement === null)).toBe(true);
    s.start(20000);
    expect(s.songTime(20000)).toBe(0);
  });
});
