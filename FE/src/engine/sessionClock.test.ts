// PlayClock 검증. 가짜 시각·클릭·반주만 쓰고 AudioContext는 쓰지 않는다.
import { describe, expect, it } from 'vitest';
import { PlayClock, type ClockAccompaniment } from './sessionClock';
import { RhythmSession } from './RhythmSession';
import type { Chart } from '@/domain/chart';

/** 120BPM(박 500ms, 마디 2000ms), 카운트인 1마디(4박) */
function makeSession(durationMs: number, offsetMs = 0, tempoSegments?: Chart['tempoSegments']): RhythmSession {
  const chart: Chart = {
    songId: 't',
    title: '테스트',
    difficulty: 'EASY',
    bpm: 120,
    offsetMs,
    beatsPerBar: 4,
    notes: [],
    source: 'BUILTIN',
    durationMs,
    ...(tempoSegments ? { tempoSegments } : {}),
  };
  return new RhythmSession(chart, { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 1, audioOffsetMs: 0 });
}

function setup(
  opts: {
    clickOn?: boolean;
    withAcc?: boolean;
    durationMs?: number;
    offsetMs?: number;
    tempoSegments?: Chart['tempoSegments'];
  } = {},
) {
  let now = 1000;
  const clicks: { at: number; accent: boolean }[] = [];
  const beats: { beatInBar: number; at: number }[] = [];
  const acc = { starts: [] as [number, number][], resumes: [] as number[], pauses: 0, stops: 0, zero: null as number | null };
  const accompaniment: ClockAccompaniment = {
    start(at, from) {
      acc.starts.push([at, from]);
      acc.zero = at - from;
    },
    pause() {
      acc.pauses += 1;
      return 0;
    },
    resume(at) {
      acc.resumes.push(at);
      acc.zero = at;
    },
    stop() {
      acc.stops += 1;
    },
    get zeroPerfMs() {
      return acc.zero;
    },
  };
  const session = makeSession(opts.durationMs ?? 1000, opts.offsetMs ?? 0, opts.tempoSegments);
  let finished = 0;
  // 가짜 타이머: 등록된 콜백을 tick으로 직접 부른다
  const timer = { fn: null as (() => void) | null, sets: 0, clears: 0 };
  let visibility: 'visible' | 'hidden' = 'visible';
  const clock = new PlayClock(session, {
    click: (at, accent) => {
      clicks.push({ at, accent });
      return at;
    },
    accompaniment: opts.withAcc === false ? undefined : accompaniment,
    clickOn: () => opts.clickOn ?? false,
    now: () => now,
    setInterval: (fn) => {
      timer.fn = fn;
      timer.sets += 1;
      return 1;
    },
    clearInterval: () => {
      timer.fn = null;
      timer.clears += 1;
    },
    visibility: () => visibility,
    onBeat: (beatInBar, at) => beats.push({ beatInBar, at }),
    onFinish: () => {
      finished += 1;
    },
  });
  return {
    clock,
    session,
    clicks,
    beats,
    acc,
    finished: () => finished,
    setNow: (n: number) => {
      now = n;
    },
    /** 타이머 틱 + rAF 프레임을 같은 시각에 */
    frame(n: number) {
      now = n;
      timer.fn?.();
      clock.onFrame(n);
    },
    /** 타이머 틱만(rAF 없음) */
    tick(n: number) {
      now = n;
      timer.fn?.();
    },
    timer,
    setVisibility: (v: 'visible' | 'hidden') => {
      visibility = v;
    },
  };
}

describe('PlayClock', () => {
  it('begin: 반주 0초 = now + lead(300) + 카운트인(2000), 세션 시계와 일치', () => {
    const t = setup();
    t.clock.begin();
    expect(t.acc.starts).toEqual([[3300, 0]]);
    expect(t.session.songTime(3300)).toBe(0);
    expect(t.session.currentStatus).toBe('countin');
    expect(t.clock.sync.begin).toBe(0);
  });

  it('빠르기 구간이 있으면 곡 중 클릭이 구간 bpm을 따른다', () => {
    // 0~4박 120bpm(박 500ms), 4박부터 60bpm(박 1000ms). 반주 0초 = 3300
    const t = setup({
      clickOn: true,
      durationMs: 5000,
      tempoSegments: [
        { beat: 0, startMs: 0, bpm: 120 },
        { beat: 4, startMs: 2000, bpm: 60 },
      ],
    });
    t.clock.begin();
    for (let n = 1000; n <= 8400; n += 50) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([1300, 1800, 2300, 2800, 3300, 3800, 4300, 4800, 5300, 6300, 7300, 8300]);
    expect(t.clicks.map((c) => c.accent)).toEqual([true, false, false, false, true, false, false, false, true, false, false, false]);
  });

  it('카운트인 클릭 4개, 첫 박만 악센트(곡 중 클릭이 꺼져 있어도)', () => {
    const t = setup({ clickOn: false });
    t.clock.begin();
    // 카운트인 박: 1300, 1800, 2300, 2800
    for (let n = 1000; n <= 3600; n += 100) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([1300, 1800, 2300, 2800]);
    expect(t.clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
    // 곡 중 박은 클릭 없이 onBeat만 불린다
    expect(t.beats.some((b) => b.at >= 3300)).toBe(true);
  });

  it('clickOn이 true면 곡 중에도 박 클릭을 낸다', () => {
    const t = setup({ clickOn: true });
    t.clock.begin();
    for (let n = 1000; n <= 4000; n += 100) t.frame(n);
    expect(t.clicks.some((c) => c.at === 3300)).toBe(true);
    expect(t.clicks.some((c) => c.at === 3800)).toBe(true);
  });

  it('offsetMs(1250) < 카운트인: 반주는 now + lead + 750에, 카운트인 4박은 원점 직전에, 곡 중 클릭은 원점부터 박 간격', () => {
    const t = setup({ clickOn: true, offsetMs: 1250, durationMs: 6000 });
    t.clock.begin();
    // 반주 0초 = 1000 + 300 + (2000 − 1250) = 2050. 원점(1마디 1박) = 2050 + 1250 = 3300
    expect(t.acc.starts).toEqual([[2050, 0]]);
    expect(t.session.songTime(2050)).toBe(0);
    for (let n = 1000; n <= 4500; n += 100) t.frame(n);
    expect(t.clicks.slice(0, 6).map((c) => c.at)).toEqual([1300, 1800, 2300, 2800, 3300, 3800]);
    expect(t.clicks.slice(0, 5).map((c) => c.accent)).toEqual([true, false, false, false, true]);
  });

  it('offsetMs(1250) < 카운트인, 곡 중 클릭 꺼짐: 카운트인 4박만 클릭(반주 0초 뒤에도 원점 전이면 클릭)', () => {
    const t = setup({ clickOn: false, offsetMs: 1250, durationMs: 6000 });
    t.clock.begin();
    for (let n = 1000; n <= 4500; n += 100) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([1300, 1800, 2300, 2800]);
  });

  it('offsetMs(3000) > 카운트인: 반주(인트로)가 now + lead에 먼저 시작되고 카운트인은 원점 직전 1마디', () => {
    const t = setup({ clickOn: false, offsetMs: 3000, durationMs: 8000 });
    t.clock.begin();
    // 반주 0초 = 1300, 원점 = 4300, 카운트인 = 2300·2800·3300·3800
    expect(t.acc.starts).toEqual([[1300, 0]]);
    for (let n = 1000; n <= 5000; n += 100) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([2300, 2800, 3300, 3800]);
    expect(t.beats.find((b) => b.at === 4300)?.beatInBar).toBe(0);
  });

  it('pause/resume 뒤에도 곡 시각이 보존되고 반주·세션 0초가 같다', () => {
    const t = setup();
    t.clock.begin();
    t.frame(3800);
    expect(t.clock.songTime(3800)).toBe(500);
    t.setNow(4000);
    t.clock.pause('user');
    expect(t.clock.state).toEqual({ phase: 'paused', reason: 'user' });
    expect(t.acc.pauses).toBe(1);
    const frozen = t.clock.songTime(4000);
    expect(frozen).toBe(700);
    expect(t.clock.songTime(9000)).toBe(700);
    t.setNow(7000);
    t.clock.resume();
    expect(t.clock.state.phase).toBe('running');
    // 재개 예약은 now + 50, 그 시각의 곡 시각이 멈춘 값과 같다(≤ 1ms)
    expect(Math.abs(t.clock.songTime(7050) - frozen)).toBeLessThanOrEqual(1);
    expect(t.acc.resumes).toEqual([7050]);
  });

  it('카운트인 중 일시정지 후 재개하면 반주는 남은 카운트인 뒤에 울린다', () => {
    const t = setup();
    t.clock.begin(); // 곡 0 = 3300
    t.setNow(2300); // 곡 -1000
    t.clock.pause('user');
    t.setNow(5000);
    t.clock.resume();
    // 재개 시각 5050에 곡 -1000, 곡 0은 6050
    expect(t.acc.resumes).toEqual([6050]);
    expect(Math.abs(t.clock.songTime(6050))).toBeLessThanOrEqual(1);
  });

  it('restart: 세션을 되돌리고 카운트인부터 다시 begin한다', () => {
    const t = setup();
    t.clock.begin();
    t.frame(3500);
    t.setNow(5000);
    t.clock.restart();
    expect(t.acc.stops).toBeGreaterThanOrEqual(1);
    expect(t.acc.starts.at(-1)).toEqual([7300, 0]);
    expect(t.session.currentStatus).toBe('countin');
    expect(t.clock.state.phase).toBe('running');
  });

  it('finished는 onFinish를 1회만 부른다', () => {
    const t = setup({ durationMs: 500 });
    t.clock.begin();
    t.frame(3300);
    t.frame(5000); // 곡 1700 > 500 + 800
    t.frame(5100);
    t.frame(5200);
    expect(t.clock.state.phase).toBe('finished');
    expect(t.finished()).toBe(1);
  });

  it('rAF 없이 타이머 틱만으로 카운트인 4박 클릭·onBeat를 예약한다', () => {
    const t = setup();
    t.clock.begin();
    for (let n = 1000; n <= 3000; n += 25) t.tick(n);
    expect(t.clicks.map((c) => c.at)).toEqual([1300, 1800, 2300, 2800]);
    expect(t.beats.map((b) => b.beatInBar)).toEqual([0, 1, 2, 3]);
  });

  it('탭이 숨겨지면 lookahead가 1200ms로 넓어져 느린 타이머에서도 박을 놓치지 않는다', () => {
    const visible = setup();
    visible.clock.begin();
    visible.tick(1000);
    visible.tick(2000); // 1초 만에 틱: 보이는 창(200ms)이면 1300·1800 박은 이미 지나 건너뛴다
    expect(visible.clicks).toEqual([]);

    const hidden = setup();
    hidden.setVisibility('hidden');
    hidden.clock.begin();
    hidden.tick(1000); // 창 1200ms: 곡 시각 -1100까지 1300·1800 예약
    expect(hidden.clicks.map((c) => c.at)).toEqual([1300, 1800]);
  });

  it('pause 중에는 타이머가 멈추고 resume에서 다시 시작한다', () => {
    const t = setup();
    t.clock.begin();
    expect(t.timer.fn).not.toBeNull();
    t.clock.pause('user');
    expect(t.timer.fn).toBeNull();
    const before = t.clicks.length;
    t.tick(1500);
    expect(t.clicks.length).toBe(before);
    t.clock.resume();
    expect(t.timer.fn).not.toBeNull();
    expect(t.timer.sets).toBe(2);
    t.clock.stop();
    expect(t.timer.fn).toBeNull();
  });

  it('반주가 없으면 sync는 null이고 클릭만 진행한다', () => {
    const t = setup({ withAcc: false });
    t.clock.begin();
    t.frame(1200);
    expect(t.clock.sync.begin).toBeNull();
    expect(t.clicks.length).toBeGreaterThan(0);
  });
});
