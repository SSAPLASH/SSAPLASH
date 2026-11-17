// PlayClock 검증. 가짜 시각·클릭·반주만 쓰고 AudioContext는 쓰지 않는다.
import { describe, expect, it } from 'vitest';
import { PlayClock, type ClockAccompaniment } from './sessionClock';
import { RhythmSession } from '@/engine/RhythmSession';
import type { Chart } from '@/domain/song/chart';
import type { ClickLevel, Subdivision } from '@/domain/time/metronome';

/** 120BPM(박 500ms, 마디 2000ms), 카운트다운 켬(preRollMs = 3000 + 1마디 2000 = 5000, 클릭은 마지막 1마디 4박) */
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
  return new RhythmSession(chart, { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 1, audioOffsetMs: 0, kickOffsetMs: 0 });
}

function setup(
  opts: {
    clickOn?: boolean;
    /** 박 분할. 함수로 주면 예약 때마다 다시 읽힌다(연주 중 변경) */
    subdivision?: () => Subdivision;
    withAcc?: boolean;
    durationMs?: number;
    offsetMs?: number;
    tempoSegments?: Chart['tempoSegments'];
  } = {},
) {
  let now = 1000;
  const clicks: { at: number; accent: boolean }[] = [];
  const levels: ClickLevel[] = [];
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
    click: (at, level) => {
      clicks.push({ at, accent: level === 'accent' });
      levels.push(level);
      return at;
    },
    subdivision: opts.subdivision,
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
    levels,
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
  it('begin: 반주 0초 = now + lead(300) + preRollMs(5000), 세션 시계와 일치', () => {
    const t = setup();
    t.clock.begin();
    expect(t.acc.starts).toEqual([[6300, 0]]);
    expect(t.session.songTime(6300)).toBe(0);
    expect(t.session.currentStatus).toBe('countin');
    expect(t.clock.sync.begin).toBe(0);
  });

  it('빠르기 구간이 있으면 곡 중 클릭이 구간 bpm을 따른다', () => {
    // 0~4박 120bpm(박 500ms), 4박부터 60bpm(박 1000ms). 반주 0초 = 6300
    const t = setup({
      clickOn: true,
      durationMs: 5000,
      tempoSegments: [
        { beat: 0, startMs: 0, bpm: 120 },
        { beat: 4, startMs: 2000, bpm: 60 },
      ],
    });
    t.clock.begin();
    for (let n = 4000; n <= 11400; n += 50) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([4300, 4800, 5300, 5800, 6300, 6800, 7300, 7800, 8300, 9300, 10300, 11300]);
    expect(t.clicks.map((c) => c.accent)).toEqual([true, false, false, false, true, false, false, false, true, false, false, false]);
  });

  it('카운트인 클릭 4개, 첫 박만 악센트(곡 중 클릭이 꺼져 있어도)', () => {
    const t = setup({ clickOn: false });
    t.clock.begin();
    // 카운트인 박(마지막 1마디만, 그 앞 3초 카운트다운은 클릭 없음): 4300, 4800, 5300, 5800
    for (let n = 1000; n <= 6600; n += 100) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([4300, 4800, 5300, 5800]);
    expect(t.clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
    // 곡 중 박은 클릭 없이 onBeat만 불린다
    expect(t.beats.some((b) => b.at >= 6300)).toBe(true);
  });

  it('clickOn이 true면 곡 중에도 박 클릭을 낸다', () => {
    const t = setup({ clickOn: true });
    t.clock.begin();
    for (let n = 4000; n <= 7000; n += 100) t.frame(n);
    expect(t.clicks.some((c) => c.at === 6300)).toBe(true);
    expect(t.clicks.some((c) => c.at === 6800)).toBe(true);
  });

  it('offsetMs(1250) < 리드인: 반주는 now + lead + 3750에, 카운트인 4박은 원점 직전에, 곡 중 클릭은 원점부터 박 간격', () => {
    const t = setup({ clickOn: true, offsetMs: 1250, durationMs: 6000 });
    t.clock.begin();
    // 반주 0초 = 1000 + 300 + (5000 − 1250) = 5050. 원점(1마디 1박) = 5050 + 1250 = 6300
    expect(t.acc.starts).toEqual([[5050, 0]]);
    expect(t.session.songTime(5050)).toBe(0);
    for (let n = 4000; n <= 7500; n += 100) t.frame(n);
    expect(t.clicks.slice(0, 6).map((c) => c.at)).toEqual([4300, 4800, 5300, 5800, 6300, 6800]);
    expect(t.clicks.slice(0, 5).map((c) => c.accent)).toEqual([true, false, false, false, true]);
  });

  it('offsetMs(1250) < 리드인, 곡 중 클릭 꺼짐: 카운트인 4박만 클릭(반주 0초 뒤에도 원점 전이면 클릭)', () => {
    const t = setup({ clickOn: false, offsetMs: 1250, durationMs: 6000 });
    t.clock.begin();
    for (let n = 4000; n <= 7500; n += 100) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([4300, 4800, 5300, 5800]);
  });

  it('offsetMs(8000) > 리드인(5000): 반주(인트로)가 now + lead에 먼저 시작되고 카운트인은 원점 직전 1마디', () => {
    const t = setup({ clickOn: false, offsetMs: 8000, durationMs: 12000 });
    t.clock.begin();
    // 반주 0초 = 1300, 원점 = 9300, 카운트인 = 7300·7800·8300·8800
    expect(t.acc.starts).toEqual([[1300, 0]]);
    for (let n = 1000; n <= 10000; n += 100) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([7300, 7800, 8300, 8800]);
    expect(t.beats.find((b) => b.at === 9300)?.beatInBar).toBe(0);
  });

  it('pause/resume 뒤에도 곡 시각이 보존되고 반주·세션 0초가 같다', () => {
    const t = setup();
    t.clock.begin();
    t.frame(6800);
    expect(t.clock.songTime(6800)).toBe(500);
    t.setNow(7000);
    t.clock.pause('user');
    expect(t.clock.state).toEqual({ phase: 'paused', reason: 'user' });
    expect(t.acc.pauses).toBe(1);
    const frozen = t.clock.songTime(7000);
    expect(frozen).toBe(700);
    expect(t.clock.songTime(12000)).toBe(700);
    t.setNow(10000);
    t.clock.resume();
    expect(t.clock.state.phase).toBe('running');
    // 재개 예약은 now + 50, 그 시각의 곡 시각이 멈춘 값과 같다(≤ 1ms)
    expect(Math.abs(t.clock.songTime(10050) - frozen)).toBeLessThanOrEqual(1);
    expect(t.acc.resumes).toEqual([10050]);
  });

  it('카운트인 중 일시정지 후 재개하면 반주는 남은 카운트인 뒤에 울린다', () => {
    const t = setup();
    t.clock.begin(); // 곡 0 = 6300
    t.setNow(5300); // 곡 -1000
    t.clock.pause('user');
    t.setNow(10000);
    t.clock.resume();
    // 재개 시각 10050에 곡 -1000, 곡 0은 11050
    expect(t.acc.resumes).toEqual([11050]);
    expect(Math.abs(t.clock.songTime(11050))).toBeLessThanOrEqual(1);
  });

  it('restart: 세션을 되돌리고 카운트인부터 다시 begin한다', () => {
    const t = setup();
    t.clock.begin();
    t.frame(6500);
    t.setNow(10000);
    t.clock.restart();
    expect(t.acc.stops).toBeGreaterThanOrEqual(1);
    expect(t.acc.starts.at(-1)).toEqual([15300, 0]);
    expect(t.session.currentStatus).toBe('countin');
    expect(t.clock.state.phase).toBe('running');
  });

  it('finished는 onFinish를 1회만 부른다', () => {
    const t = setup({ durationMs: 500 });
    t.clock.begin();
    t.frame(6300);
    t.frame(8000); // 곡 1700 > 500 + 800
    t.frame(8100);
    t.frame(8200);
    expect(t.clock.state.phase).toBe('finished');
    expect(t.finished()).toBe(1);
  });

  it('rAF 없이 타이머 틱만으로 카운트인 4박 클릭·onBeat를 예약한다', () => {
    const t = setup();
    t.clock.begin();
    for (let n = 4000; n <= 6000; n += 25) t.tick(n);
    expect(t.clicks.map((c) => c.at)).toEqual([4300, 4800, 5300, 5800]);
    expect(t.beats.map((b) => b.beatInBar)).toEqual([0, 1, 2, 3]);
  });

  it('탭이 숨겨지면 lookahead가 1200ms로 넓어져 느린 타이머에서도 박을 놓치지 않는다', () => {
    const visible = setup();
    visible.clock.begin();
    visible.tick(4000);
    visible.tick(5000); // 1초 만에 틱: 보이는 창(200ms)이면 4300·4800 박은 이미 지나 건너뛴다
    expect(visible.clicks).toEqual([]);

    const hidden = setup();
    hidden.setVisibility('hidden');
    hidden.clock.begin();
    hidden.tick(4000); // 창 1200ms: 5200까지 4300·4800 예약
    expect(hidden.clicks.map((c) => c.at)).toEqual([4300, 4800]);
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
    t.frame(4200);
    expect(t.clock.sync.begin).toBeNull();
    expect(t.clicks.length).toBeGreaterThan(0);
  });
});

describe('PlayClock 박 분할 (설계 MODE-002-MODE-003-metronome-subdivision)', () => {
  // 반주 0초 = 6300, 준비 마디 4박 = 4300·4800·5300·5800 (120BPM, 박 500ms)
  it('8분 + 클릭 켬: 준비 마디와 곡 중 모두 박마다 2번, 박 표시는 박마다 1번', () => {
    const t = setup({ clickOn: true, subdivision: () => 2 });
    t.clock.begin();
    for (let n = 4000; n <= 7200; n += 50) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([4300, 4550, 4800, 5050, 5300, 5550, 5800, 6050, 6300, 6550, 6800, 7050, 7300]);
    expect(t.levels).toEqual(['accent', 'sub', 'beat', 'sub', 'beat', 'sub', 'beat', 'sub', 'accent', 'sub', 'beat', 'sub', 'beat']);
    expect(t.beats.map((b) => b.at)).toEqual([4300, 4800, 5300, 5800, 6300, 6800, 7300]);
    expect(t.beats.map((b) => b.beatInBar)).toEqual([0, 1, 2, 3, 0, 1, 2]);
  });

  it('8분 + 클릭 끔: 준비 마디는 4분 클릭만, 곡 중에는 소리 없이 박 표시만', () => {
    const t = setup({ clickOn: false, subdivision: () => 2 });
    t.clock.begin();
    for (let n = 4000; n <= 7200; n += 50) t.frame(n);
    expect(t.clicks.map((c) => c.at)).toEqual([4300, 4800, 5300, 5800]);
    expect(t.levels).toEqual(['accent', 'beat', 'beat', 'beat']);
    expect(t.beats.filter((b) => b.at >= 6300).map((b) => b.at)).toEqual([6300, 6800, 7300]);
  });

  it('subdivision을 안 주면 4분(리듬 게임과 같은 조건)', () => {
    const t = setup({ clickOn: true });
    t.clock.begin();
    for (let n = 4000; n <= 7200; n += 50) t.frame(n);
    expect(t.levels).not.toContain('sub');
    expect(t.clicks.map((c) => c.at)).toEqual([4300, 4800, 5300, 5800, 6300, 6800, 7300]);
  });

  it('빠르기 구간이 있으면 사이 박이 그 구간 bpm의 반 박에 온다', () => {
    // 0~4박 120bpm(박 500ms), 4박부터 60bpm(박 1000ms)
    const t = setup({
      clickOn: true,
      subdivision: () => 2,
      durationMs: 5000,
      tempoSegments: [
        { beat: 0, startMs: 0, bpm: 120 },
        { beat: 4, startMs: 2000, bpm: 60 },
      ],
    });
    t.clock.begin();
    for (let n = 6200; n <= 10400; n += 50) t.frame(n);
    const song = t.clicks.filter((c) => c.at >= 6300).map((c) => c.at - 6300);
    expect(song).toEqual([0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 3500, 4000]);
  });

  it('연주 중 4분 → 8분 → 4분으로 바꾸면 한 박 안에 반영되고 박 표시는 끊기지 않는다', () => {
    let sub: Subdivision = 1;
    const t = setup({ clickOn: true, subdivision: () => sub, durationMs: 6000 });
    t.clock.begin();
    for (let n = 6200; n <= 7000; n += 50) t.frame(n);
    sub = 2;
    for (let n = 7050; n <= 8000; n += 50) t.frame(n);
    sub = 1;
    for (let n = 8050; n <= 9400; n += 50) t.frame(n);
    const song = t.clicks.filter((c) => c.at >= 6300).map((c) => c.at - 6300);
    // 0.7초에 8분으로: 이미 예약된 1박(500) 뒤 다음 박(1000)부터 사이 박.
    // 1.7초에 4분으로: 예약 창(200ms) 안이라 이미 예약된 사이 박(1750)은 울리고 다음 정박(2000)부터 4분
    expect(song).toEqual([0, 500, 1000, 1250, 1500, 1750, 2000, 2500, 3000]);
    expect(t.beats.filter((b) => b.at >= 6300).map((b) => b.at - 6300)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000]);
  });

  it('탭이 가려져 넓은 창으로 예약해도 8분 틱이 빠지거나 겹치지 않는다', () => {
    const t = setup({ clickOn: true, subdivision: () => 2, durationMs: 6000 });
    t.clock.begin();
    t.setVisibility('hidden');
    for (let n = 4000; n <= 10000; n += 1000) t.tick(n);
    const at = t.clicks.map((c) => c.at);
    at.forEach((v, i) => expect(v).toBe(4300 + i * 250));
    expect(at.length).toBeGreaterThan(20);
  });
});
