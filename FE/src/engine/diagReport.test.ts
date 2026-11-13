import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Chart } from '@/domain/song/chart';
import type { ResolvedHit } from '@/domain/events';
import { diagTap, type DiagEvent } from './diagTap';
import { addDiagSessionStartHook, addPlayStartHook, diagActiveAudioOffsetMs, diagActiveKickOffsetMs, diagSessionEnd, diagSessionPhase, diagSessionStart, onDiagSessionStart, reportHit } from './diagReport';
import { RhythmSession } from './RhythmSession';

const chart: Chart = {
  songId: 'song',
  title: '곡',
  difficulty: 'EASY',
  bpm: 120,
  offsetMs: 0,
  beatsPerBar: 4,
  notes: [
    { timeMs: 1000, pad: 'SNARE' },
    { timeMs: 2000, pad: 'SNARE' },
  ],
  source: 'BUILTIN',
  durationMs: 3000,
};
const windows = { perfectMs: 25, goodMs: 60 };
const mkSession = () => new RhythmSession(chart, { windows, countInBars: 0, audioOffsetMs: 0, kickOffsetMs: 0 });
const hit = (over: Partial<ResolvedHit> = {}): ResolvedHit => ({
  id: 1,
  stickId: 0,
  pad: 'SNARE',
  velocity: 80,
  tHit: 1000,
  tRecv: 1000,
  tResolved: 1001,
  source: 'keyboard',
  pose: { pitch: 0, yaw: 0 },
  peakAccel: 6,
  judgedBy: 'key',
  ...over,
});

const events: DiagEvent[] = [];
const off = diagTap.subscribe((e) => events.push(e));
afterEach(() => {
  diagSessionEnd('left');
  events.length = 0;
});
afterAll(off);

describe('reportHit', () => {
  it('매칭된 타격은 judged(판정·노트·delta)를 낸다', () => {
    const ss = mkSession();
    ss.start(0);
    const h = hit({ tHit: 1010, tResolved: 1011 });
    const ev = ss.handleHit(h);
    reportHit(h, ev, ss);
    expect(events).toHaveLength(1);
    const d = events[0];
    expect(d.type === 'judged' && d.judgement).toBe('PERFECT');
    expect(d.type === 'judged' && d.noteIndex).toBe(0);
    expect(d.type === 'judged' && d.deltaMs).toBe(10);
    expect(d.type === 'judged' && d.hitPad).toBe('SNARE');
  });

  it('채보 밖 타격(ev 없음)은 judgement 없는 judged, 곧 stray', () => {
    const ss = mkSession();
    ss.start(0);
    const h = hit({ tHit: 500 });
    reportHit(h, ss.handleHit(h), ss);
    const d = events[0];
    expect(d.type === 'judged' && d.judgement).toBeNull();
    expect(d.type === 'judged' && d.noteIndex).toBeNull();
  });

  it('세션이 없으면(채점 꺼짐) judged를 내지 않는다', () => {
    reportHit(hit(), null, null);
    expect(events).toHaveLength(0);
  });
});

describe('세션 진단', () => {
  it('session 줄과 활성 값에 kickOffsetMs를 싣는다', () => {
    diagSessionStart(mkSession(), 'RHYTHM', { windows, audioOffsetMs: -65, kickOffsetMs: -40 });
    const s = events[0];
    expect(s).toMatchObject({ type: 'session', audioOffsetMs: -65, kickOffsetMs: -40 });
    expect(diagActiveAudioOffsetMs()).toBe(-65);
    expect(diagActiveKickOffsetMs()).toBe(-40);
  });

  it('session 줄에 이 판의 진동 방식(haptic)을 싣고, 없으면 판정 진동이다', () => {
    diagSessionStart(mkSession(), 'RHYTHM', { windows, audioOffsetMs: 0, kickOffsetMs: 0, haptic: 'local' });
    expect(events[0]).toMatchObject({ type: 'session', haptic: 'local' });
    events.length = 0;
    diagSessionStart(mkSession(), 'RHYTHM', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });
    expect(events[0]).toMatchObject({ type: 'session', haptic: 'judgement' });
  });

  it('시작은 session start와 notes를 내고, 시간 초과 MISS는 missed로 파생된다', () => {
    const ss = mkSession();
    diagSessionStart(ss, 'RHYTHM', { windows, audioOffsetMs: 5, kickOffsetMs: 5 });
    expect(events.map((e) => e.type)).toEqual(['session', 'notes']);
    const s = events[0];
    expect(s.type === 'session' && s.phase).toBe('start');
    expect(s.type === 'session' && s.noteCount).toBe(2);
    ss.start(0);
    ss.tick(1100); // 첫 노트(1000ms) 창 지남 → MISS
    const missed = events.filter((e) => e.type === 'missed');
    expect(missed).toHaveLength(1);
    expect(missed[0].type === 'missed' && missed[0].noteIndex).toBe(0);
  });

  it('타격으로 맞춘 노트는 missed가 아니다', () => {
    const ss = mkSession();
    diagSessionStart(ss, 'SHEET', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });
    ss.start(0);
    ss.handleHit(hit({ tHit: 1000 }));
    expect(events.filter((e) => e.type === 'missed')).toHaveLength(0);
  });

  it('일시정지·재개·종료 순서로 session을 내고 종료에는 요약이 붙는다', () => {
    const ss = mkSession();
    diagSessionStart(ss, 'RHYTHM', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });
    events.length = 0;
    diagSessionPhase('pause');
    diagSessionPhase('resume');
    diagSessionEnd('finished');
    const phases = events.map((e) => (e.type === 'session' ? e.phase : e.type));
    expect(phases).toEqual(['pause', 'resume', 'end']);
    const end = events[2];
    expect(end.type === 'session' && end.reason).toBe('finished');
    expect(end.type === 'session' && end.summary?.maxScore).toBe(200);
    // 종료 뒤 또 불러도 무동작
    diagSessionEnd('left');
    expect(events).toHaveLength(3);
  });
});

describe('곡 시작 anchors 줄 (PLAY-002 실연주 진단)', () => {
  const a = (pad: 'SNARE' | 'HIHAT', yaw: number) => ({ pad, pitch: 10, yaw, radius: 12, radiusOverride: 12, samples: 2, spread: 1.5 });

  it('session start·notes 뒤에 anchors를 1회 낸다. 보정 안 한 손은 null', () => {
    const ss = mkSession();
    diagSessionStart(ss, 'RHYTHM', {
      windows,
      audioOffsetMs: 0, kickOffsetMs: 0,
      anchors: [{ SNARE: a('SNARE', -20), HIHAT: a('HIHAT', -50) }, null],
      calibratedAt: 1234,
      presetId: 'system',
    });
    expect(events.map((e) => e.type)).toEqual(['session', 'notes', 'anchors']);
    const ev = events[2];
    if (ev.type !== 'anchors') throw new Error('anchors 아님');
    expect(ev.hands[1]).toBeNull();
    expect(ev.hands[0]).toEqual([
      { pad: 'SNARE', pitch: 10, yaw: -20, radius: 12, samples: 2, spread: 1.5 },
      { pad: 'HIHAT', pitch: 10, yaw: -50, radius: 12, samples: 2, spread: 1.5 },
    ]);
    expect(ev.calibratedAt).toBe(1234);
    expect(ev.presetId).toBe('system');
  });

  it('재시작하면 다시 낸다. anchors를 넘기지 않으면 내지 않는다', () => {
    const ss = mkSession();
    const opts = { windows, audioOffsetMs: 0, kickOffsetMs: 0, anchors: [null, null] as [null, null] };
    diagSessionStart(ss, 'SHEET', opts);
    diagSessionStart(ss, 'SHEET', opts);
    const anchors = events.filter((e) => e.type === 'anchors');
    expect(anchors).toHaveLength(2);
    expect(anchors[0].type === 'anchors' && anchors[0].calibratedAt).toBeNull();
    events.length = 0;
    diagSessionStart(ss, 'SHEET', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });
    expect(events.map((e) => e.type)).toEqual(['session', 'notes']);
  });

  it('곡 시작 훅은 anchors 뒤에 1회 불린다', () => {
    const order: string[] = [];
    const offOrder = diagTap.subscribe((e) => order.push(e.type));
    onDiagSessionStart(() => order.push('hook'));
    diagSessionStart(mkSession(), 'RHYTHM', { windows, audioOffsetMs: 0, kickOffsetMs: 0, anchors: [null, null] });
    onDiagSessionStart(null);
    offOrder();
    expect(order).toEqual(['session', 'notes', 'anchors', 'hook']);
  });
});

describe('곡 시작 훅', () => {
  it('addPlayStartHook은 진단 구독이 없어도 곡 시작(재시작 포함)마다 불리고, 해제하면 멈춘다', () => {
    // 진단 구독을 잠시 내려 diagTap.active가 거짓인 상태를 만든다
    off();
    try {
      expect(diagTap.active).toBe(false);
      let play = 0;
      let diag = 0;
      const offPlay = addPlayStartHook(() => play++);
      const offDiag = addDiagSessionStartHook(() => diag++);
      diagSessionStart(mkSession(), 'RHYTHM', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });
      diagSessionStart(mkSession(), 'SHEET', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });
      expect(play).toBe(2);
      // 기존 훅은 진단 구독 중에만 돈다(동작 그대로)
      expect(diag).toBe(0);
      offPlay();
      offDiag();
      diagSessionStart(mkSession(), 'RHYTHM', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });
      expect(play).toBe(2);
    } finally {
      diagTap.subscribe((e) => events.push(e));
    }
  });
});
