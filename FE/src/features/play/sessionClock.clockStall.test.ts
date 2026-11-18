// PlayClock의 곡 도중 오디오 시계 멈춤 감지(진단 기록만, 설계 MODE-001 오디오 시계 시작 대기 D6). 연주에는 손대지 않는다.
import { afterEach, describe, expect, it } from 'vitest';
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import { PlayClock, ACC_DRIFT_INTERVAL_MS } from './sessionClock';
import { RhythmSession } from '@/engine/RhythmSession';
import type { Chart } from '@/domain/song/chart';

function makeSession(): RhythmSession {
  const chart: Chart = { songId: 't', title: '테스트', difficulty: 'EASY', bpm: 120, offsetMs: 0, beatsPerBar: 4, notes: [], source: 'BUILTIN', durationMs: 20 * 60_000 };
  return new RhythmSession(chart, { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 1, audioOffsetMs: 0, kickOffsetMs: 0 });
}

/** 오디오 시계는 화면 시계보다 lagMs만큼 뒤에 있다(lag를 키우면 그만큼 멈췄던 것) */
function setup(withAudioClock = true) {
  let now = 1000;
  let lagMs = 300;
  let tickFn: (() => void) | null = null;
  const clock = new PlayClock(makeSession(), {
    click: (at) => at,
    clickOn: () => false,
    now: () => now,
    setInterval: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearInterval: () => {
      tickFn = null;
    },
    visibility: () => 'visible',
    ...(withAudioClock ? { audioClock: () => ({ perfMs: now, ctxSec: (now - lagMs) / 1000 }) } : {}),
  });
  return {
    clock,
    tick(n: number) {
      now = n;
      tickFn?.();
    },
    stall(ms: number) {
      lagMs += ms;
    },
  };
}

const events: DiagEvent[] = [];
let unsub: (() => void) | null = null;
afterEach(() => {
  unsub?.();
  unsub = null;
  events.length = 0;
});
const listen = () => {
  unsub = diagTap.subscribe((e) => events.push(e));
};
const stalls = () => events.filter((e) => e.type === 'audioClockStall');

describe('PlayClock 곡 도중 오디오 시계 멈춤 감지', () => {
  it('오디오 시계가 화면 시계와 같이 흐르면 이벤트가 없다', () => {
    listen();
    const s = setup();
    s.clock.begin();
    for (let t = 1000; t <= 6000; t += ACC_DRIFT_INTERVAL_MS) s.tick(t);
    expect(stalls()).toEqual([]);
  });

  it('차이가 50ms 넘게 커지면 audioClockStall을 한 번 낸다(커진 양 포함)', () => {
    listen();
    const s = setup();
    s.clock.begin();
    s.tick(1500);
    s.tick(2000);
    s.stall(400);
    s.tick(2500);
    s.tick(3000);
    expect(stalls()).toHaveLength(1);
    expect(stalls()[0]).toMatchObject({ type: 'audioClockStall', jumpMs: 400 });
    expect(s.clock.state.phase).toBe('running');
  });

  it('50ms 이하의 흔들림은 무시한다', () => {
    listen();
    const s = setup();
    s.clock.begin();
    s.tick(1500);
    s.stall(50);
    s.tick(2000);
    expect(stalls()).toEqual([]);
  });

  it('일시정지 사이에 벌어진 차이는 멈춤으로 보지 않는다(재개 뒤 새 기준)', () => {
    listen();
    const s = setup();
    s.clock.begin();
    s.tick(1500);
    s.clock.pause('user');
    s.stall(5000);
    s.clock.resume();
    s.tick(7000);
    s.tick(7500);
    expect(stalls()).toEqual([]);
  });

  it('구독자가 없거나 오디오 시계를 못 읽으면 아무것도 하지 않는다', () => {
    const quiet = setup();
    quiet.clock.begin();
    quiet.tick(1500);
    quiet.stall(400);
    quiet.tick(2000);
    listen();
    expect(stalls()).toEqual([]);
    const none = setup(false);
    none.clock.begin();
    none.tick(1500);
    none.tick(2000);
    expect(stalls()).toEqual([]);
  });
});
