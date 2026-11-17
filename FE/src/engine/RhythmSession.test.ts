// 리듬 게임 세션(설계 4-2 판정 절차) 규칙 검증. 가짜 시각(ms)만 넣고 performance.now는 쓰지 않는다.
import { describe, expect, it } from 'vitest';
import { RhythmSession, type RhythmOptions, type StrayHitEvent } from './RhythmSession';
import type { Chart, ChartNote } from '@/domain/song/chart';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';

const OPTS: RhythmOptions = { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 1, audioOffsetMs: 0, kickOffsetMs: 0 };

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
  it('idle일 때 곡 시각은 −preRollMs(5000)로 고정된다', () => {
    const s = new RhythmSession(chart(NOTES), OPTS);
    expect(s.countInMs).toBe(2000);
    expect(s.songTime(5000)).toBe(-5000);
    expect(s.songTime(99999)).toBe(-5000);
  });

  it('preRollMs: 카운트다운 끔이면 0, 켬이면 3000 + 1마디', () => {
    expect(new RhythmSession(chart(NOTES), { ...OPTS, countInBars: 0 }).preRollMs).toBe(0);
    expect(new RhythmSession(chart(NOTES), { ...OPTS, countInBars: 0 }).songTime(1)).toBe(0);
    expect(new RhythmSession(chart(NOTES), OPTS).preRollMs).toBe(5000);
    // 카운트다운 3초에 1마디(90bpm 4/4 = 2667ms, 40bpm 4/4 = 6000ms)를 더한다
    expect(new RhythmSession({ ...chart(NOTES), bpm: 90 }, OPTS).preRollMs).toBeCloseTo(5666.67, 1);
    expect(new RhythmSession({ ...chart(NOTES), bpm: 40 }, OPTS).preRollMs).toBe(9000);
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
  it('같은 패드 노트가 여럿이면 판정 폭 안의 가장 이른 노트에 배정한다(설계 3-1, 이전 규칙은 가장 가까운 노트)', () => {
    const s = playing();
    const ev = s.handleHit(hit('SNARE', T0 + 1060));
    expect(ev?.noteIndex).toBe(0);
    expect(ev?.deltaMs).toBe(60);
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

  it('점수: Perfect 100, Good 80(330번), 만점 = 노트 수 × 100', () => {
    const s = playing();
    s.handleHit(hit('HIHAT', T0 + 1000));
    s.handleHit(hit('SNARE', T0 + 1040));
    const snap = s.snapshot(T0 + 1100);
    expect(snap.score).toBe(180);
    expect(snap.maxScore).toBe(500);
    expect(snap.counts).toEqual({ PERFECT: 1, GOOD: 1, MISS: 0 });
    expect(snap.judgedCount).toBe(2);
  });

  it('오디오 오프셋은 타격 시각에서 뺀다', () => {
    const s = playing(NOTES, { ...OPTS, audioOffsetMs: 10, kickOffsetMs: 10 });
    const ev = s.handleHit(hit('HIHAT', T0 + 1010));
    expect(ev?.deltaMs).toBe(0);
  });

  it('발 타격은 킥 오프셋, 손 타격은 스틱 오프셋으로 곡 시각을 계산한다', () => {
    const opts = { ...OPTS, audioOffsetMs: -65, kickOffsetMs: -40 };
    const footHit = { ...hit('KICK', T0 + 1500 - 40), foot: 3 } as ResolvedHit;
    const handHit = hit('SNARE', T0 + 1000 - 65);
    // 킥 값을 쓰면 발 타격은 0ms, 스틱 값을 쓴다면 25ms 늦게 판정된다
    expect(playing(NOTES, opts).handleHit(footHit)?.deltaMs).toBe(0);
    expect(playing(NOTES, opts).handleHit(handHit)?.deltaMs).toBe(0);
    // 같은 tHit라도 값 차이(25ms)만큼 delta가 다르다
    const same = { ...opts, kickOffsetMs: -65 };
    expect(playing(NOTES, same).handleHit(footHit)?.deltaMs).toBe(25);
    const s = playing(NOTES, opts);
    expect(s.hitSongTimeMs(T0 + 1000, true)).toBe(1040);
    expect(s.hitSongTimeMs(T0 + 1000)).toBe(1065);
    expect(s.kickOffsetMs).toBe(-40);
  });

  it('두 값이 같으면 발 타격도 손 타격과 같은 곡 시각이다', () => {
    const s = playing(NOTES, { ...OPTS, audioOffsetMs: 10, kickOffsetMs: 10 });
    expect(s.hitSongTimeMs(T0 + 1010, true)).toBe(s.hitSongTimeMs(T0 + 1010));
  });

  it('IMU 후보 패드 계산은 스틱 오프셋을 쓴다', () => {
    // 곡 시각 1000 근처: 스틱 값이면 1000(SNARE·HIHAT 후보), 킥 값이면 1500 근처로 밀려 KICK이 후보에 든다
    const s = playing(NOTES, { ...OPTS, audioOffsetMs: 0, kickOffsetMs: 450 });
    const c = s.candidates(T0 + 1000) ?? [];
    expect(c).toContain('SNARE');
    expect(c).not.toContain('CRASH');
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

  it('채보 밖 타격을 패드·곡 시각과 함께 알리고, 받는 쪽 오류는 세션에 전하지 않는다', () => {
    const s = playing(NOTES, { ...OPTS, audioOffsetMs: 10, kickOffsetMs: 10 });
    const got: StrayHitEvent[] = [];
    s.onStray(() => {
      throw new Error('코칭 오류');
    });
    const off = s.onStray((e) => got.push(e));
    expect(() => s.handleHit(hit('RIDE', T0 + 1010))).not.toThrow();
    // 키보드 타격은 손·방향이 없다
    expect(got).toEqual([{ pad: 'RIDE', songTimeMs: 1000, nearDeltaMs: null, stickId: null, pose: null }]);
    expect(s.snapshot(T0 + 1010).strayHits).toBe(1);
    off();
    s.handleHit(hit('RIDE', T0 + 1020));
    expect(got).toHaveLength(1);
  });

  it('센서 타격이면 판정·채보 밖 타격에 손과 스틱 끝 방향을 싣는다(연주 중 코칭 aim)', () => {
    const s = playing(NOTES, OPTS);
    const strays: StrayHitEvent[] = [];
    s.onStray((e) => strays.push(e));
    const sensor = (pad: PadId, t: number): ResolvedHit => ({ ...hit(pad, t), source: 'stick', stickId: 1, pose: { pitch: -32, yaw: 4 } });
    const j = s.handleHit(sensor('SNARE', T0 + 1005));
    expect(j).toMatchObject({ stickId: 1, pose: { pitch: -32, yaw: 4 } });
    s.handleHit(sensor('RIDE', T0 + 1010));
    expect(strays[0]).toMatchObject({ pad: 'RIDE', stickId: 1, pose: { pitch: -32, yaw: 4 } });
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

describe('채보 밖 타격의 가까운 노트 차(nearDeltaMs, 설계 MODE-003-timing-bar-miss-dot)', () => {
  // 스네어 1000·1100, 킥 1500. goodMs 60 → 판정 범위 ±60, 찾는 범위 ±120
  const near = (s: RhythmSession) => {
    const got: (number | null)[] = [];
    s.onStray((e) => got.push(e.nearDeltaMs));
    return got;
  };

  it('범위 밖으로 빠르게 치면 음수(가장 가까운 같은 패드 노트 기준)', () => {
    const s = playing();
    const got = near(s);
    s.handleHit(hit('KICK', T0 + 1420));
    expect(got).toEqual([-80]);
  });

  it('놓친(MISS) 노트 뒤에 늦게 치면 양수', () => {
    const s = playing();
    const got = near(s);
    s.tick(T0 + 1570); // 킥 1500이 MISS가 된다
    s.handleHit(hit('KICK', T0 + 1590));
    expect(got).toEqual([90]);
  });

  it('이미 친 노트 옆 추가 타격, 찾는 범위 밖, 다른 패드는 null', () => {
    const s = playing();
    const got = near(s);
    s.handleHit(hit('KICK', T0 + 1500)); // PERFECT
    s.handleHit(hit('KICK', T0 + 1580)); // 친 노트 옆 → null
    s.handleHit(hit('CRASH', T0 + 1850)); // 크래시 2000까지 −150, 범위 밖 → null
    s.handleHit(hit('RIDE', T0 + 1930)); // 라이드 노트 없음 → null
    expect(got).toEqual([null, null, null]);
  });

  it('노트가 없는 채보에서도 터지지 않는다', () => {
    const s = playing([]);
    const got = near(s);
    s.handleHit(hit('SNARE', T0 + 100));
    expect(got).toEqual([null]);
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

describe('판정 이벤트의 손·세기', () => {
  it('센서 타격 판정에는 타격한 손과 세기가 실린다', () => {
    const s = playing();
    const ev = s.handleHit({ ...hit('HIHAT', T0 + 1000), source: 'ble', stickId: 1, velocity: 87 });
    expect(ev?.stickId).toBe(1);
    expect(ev?.velocity).toBe(87);
    expect(s.snapshot(T0 + 1000).last).toMatchObject({ stickId: 1, velocity: 87 });
  });

  it('키보드 타격 판정은 손·세기가 null이다', () => {
    const ev = playing().handleHit(hit('HIHAT', T0 + 1000));
    expect(ev?.judgement).toBe('PERFECT');
    expect(ev?.stickId).toBeNull();
    expect(ev?.velocity).toBeNull();
  });

  it('MISS 판정은 손·세기가 null이고 리스너에도 그대로 간다', () => {
    const s = playing();
    const got: Array<[number | null, number | null]> = [];
    s.onJudgement((e) => {
      if (e.judgement === 'MISS') got.push([e.stickId, e.velocity]);
    });
    s.tick(T0 + 1100); // 1000ms 노트 둘이 창(60ms)을 지났다
    expect(got).toEqual([
      [null, null],
      [null, null],
    ]);
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

describe('촘촘한 같은 패드 노트 매칭 (MODE-001-judge-window 3-1)', () => {
  const kicks = (gap: number, n = 3) => Array.from({ length: n }, (_, i) => i).map((i) => ({ timeMs: 1000 + i * gap, pad: 'KICK' as PadId }));
  const run = (notes: ChartNote[], hits: number[]) => {
    const s = playing(notes);
    const evs = hits.map((t) => s.handleHit(hit('KICK', T0 + t)));
    s.tick(T0 + 1600);
    return { s, evs, snap: s.snapshot(T0 + 1600) };
  };

  it('1-2 재현: 100ms 간격, 매번 +55 -> 세 노트 모두 GOOD +55', () => {
    const { s, evs, snap } = run(kicks(100), [1055, 1155, 1255]);
    expect(evs.map((e) => [e?.noteIndex, e?.judgement, e?.deltaMs])).toEqual([
      [0, 'GOOD', 55],
      [1, 'GOOD', 55],
      [2, 'GOOD', 55],
    ]);
    expect(snap.counts.MISS).toBe(0);
    expect(snap.strayHits).toBe(0);
    expect(snap.contestedHits).toBeGreaterThanOrEqual(2);
    expect(s.lastContestedMatch?.rule).toBe('earliest');
  });

  it('매번 -55 -> 세 노트 모두 GOOD -55', () => {
    const { evs } = run(kicks(100), [945, 1045, 1145]);
    expect(evs.map((e) => [e?.noteIndex, e?.judgement, e?.deltaMs])).toEqual([
      [0, 'GOOD', -55],
      [1, 'GOOD', -55],
      [2, 'GOOD', -55],
    ]);
  });

  it('1번 건너뛰고 2번을 +0 -> 2번 PERFECT', () => {
    const { evs } = run(kicks(100), [1100]);
    expect(evs[0]).toMatchObject({ noteIndex: 1, judgement: 'PERFECT', deltaMs: 0 });
  });

  it('간격 50ms, 1번 건너뛰고 2번 +10 -> 예외로 2번 PERFECT', () => {
    const { s, evs } = run(kicks(50, 2), [1060]);
    expect(evs[0]).toMatchObject({ noteIndex: 1, judgement: 'PERFECT', deltaMs: 10 });
    expect(s.lastContestedMatch?.rule).toBe('perfect-exception');
  });

  it('간격 50ms, 2번 +30 -> 2번 GOOD +30', () => {
    const { evs } = run(kicks(50, 2), [1080]);
    expect(evs[0]).toMatchObject({ noteIndex: 1, judgement: 'GOOD', deltaMs: 30 });
  });

  it('간격 40ms, 2번 -30 -> 1번 PERFECT +10', () => {
    const { evs } = run(kicks(40, 2), [1010]);
    expect(evs[0]).toMatchObject({ noteIndex: 0, judgement: 'PERFECT', deltaMs: 10 });
  });

  it('경합 한 번 세고 reset하면 경합 수가 비워진다', () => {
    const { s } = run(kicks(100), [1050]);
    expect(s.snapshot(T0 + 1600).contestedHits).toBe(1);
    s.reset();
    expect(s.snapshot().contestedHits).toBe(0);
    expect(s.lastContestedMatch).toBeNull();
  });
});

it('열린 하이햇 속성은 같은 채보의 판정·점수·콤보를 바꾸지 않는다', () => {
  const run = (opened: boolean) => {
    const notes: ChartNote[] = [{ timeMs: 1000, pad: 'HIHAT', ...(opened ? { hihatOpen: true as const } : {}) }, { timeMs: 1500, pad: 'SNARE' }];
    const ss = playing(notes);
    const first = ss.handleHit({ ...hit('HIHAT', T0 + 1000), hihatClosed: true });
    const second = ss.handleHit(hit('SNARE', T0 + 1540));
    const snap = ss.snapshot(T0 + 1600);
    return { judgements: [first?.judgement, second?.judgement], score: snap.score, combo: snap.combo, maxCombo: snap.maxCombo, counts: snap.counts };
  };
  expect(run(true)).toEqual(run(false));
  expect(run(true)).toMatchObject({ judgements: ['PERFECT', 'GOOD'], score: 180, maxCombo: 2 });
});
