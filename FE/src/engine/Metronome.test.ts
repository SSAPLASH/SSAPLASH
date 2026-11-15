// 메트로놈 스케줄러 검증. 가짜 시계·타이머·sink만 쓰고 performance.now·실제 타이머는 쓰지 않는다.
import { beforeEach, describe, expect, it } from 'vitest';
import { HIDDEN_LOOKAHEAD_MS, LOOKAHEAD_MS, Metronome, START_LEAD_MS, TICK_MS } from './Metronome';
import type { ClickLevel } from '@/domain/time/metronome';

interface Click {
  atMs: number;
  accent: boolean;
}

function setup(opts: { drift?: number } = {}) {
  let now = 1000;
  let visibility: 'visible' | 'hidden' = 'visible';
  let tickFn: (() => void) | null = null;
  let audioListener: ((state: string) => void) | null = null;
  const clicks: Click[] = [];
  const levels: ClickLevel[] = [];
  const m = new Metronome();
  m.bind({
    click: (atMs, level) => {
      clicks.push({ atMs, accent: level === 'accent' });
      levels.push(level);
      return atMs + (opts.drift ?? 0);
    },
    ensureAudio: () => Promise.resolve(),
    now: () => now,
    setInterval: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearInterval: () => {
      tickFn = null;
    },
    visibility: () => visibility,
    onAudioState: (l) => {
      audioListener = l;
    },
  });
  return {
    m,
    clicks,
    levels,
    /** 시각을 ms만큼 25ms 틱 단위로 흘린다 */
    advance(ms: number) {
      for (let t = 0; t < ms; t += TICK_MS) {
        now += TICK_MS;
        tickFn?.();
      }
    },
    setNow: (v: number) => {
      now = v;
    },
    tickNow: () => tickFn?.(),
    setVisibility: (v: 'visible' | 'hidden') => {
      visibility = v;
    },
    audio: (s: string) => audioListener?.(s),
    isTicking: () => tickFn !== null,
  };
}

describe('Metronome 스케줄링', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('bind 전 start는 아무 일도 하지 않는다', async () => {
    const m = new Metronome();
    await m.start();
    expect(m.state.playing).toBe(false);
  });

  it('start는 now + START_LEAD_MS에 첫 박을 예약하고 박 시각은 BPM 간격이다', async () => {
    await t.m.start();
    expect(t.m.state.playing).toBe(true);
    expect(t.clicks[0]).toEqual({ atMs: 1000 + START_LEAD_MS, accent: true });
    t.advance(1600);
    const times = t.clicks.map((c) => c.atMs);
    expect(times.slice(0, 4)).toEqual([1075, 1575, 2075, 2575]);
    // 순서가 단조 증가하고 중복이 없다
    expect(times.every((v, i) => i === 0 || v > times[i - 1])).toBe(true);
  });

  it('4/4는 4박마다, 3/4는 3박마다 악센트', async () => {
    await t.m.start();
    t.advance(4200);
    expect(t.clicks.slice(0, 8).map((c) => c.accent)).toEqual([true, false, false, false, true, false, false, false]);

    const t3 = setup();
    t3.m.setBeatsPerBar(3);
    await t3.m.start();
    t3.advance(3200);
    expect(t3.clicks.slice(0, 7).map((c) => c.accent)).toEqual([true, false, false, true, false, false, true]);
  });

  it('창은 LOOKAHEAD_MS만큼만 앞서 예약한다', async () => {
    await t.m.start();
    // now=1000, 창 끝 1100 → 박 1075만. 다음 박 1575는 아직 예약 안 됨
    expect(t.clicks).toHaveLength(1);
    expect(t.m.nextBeat()?.atMs).toBe(1575);
    expect(LOOKAHEAD_MS).toBe(100);
  });

  it('BPM 변경 후에도 다음 박 시각은 보존되고 그 뒤부터 새 간격', async () => {
    await t.m.start();
    t.advance(500); // now=1500, 박 1575 예약됨(창 1600), 다음 박은 2075
    expect(t.m.nextBeat()?.atMs).toBe(2075);
    t.m.setBpm(60);
    expect(t.m.nextBeat()?.atMs).toBe(2075);
    t.advance(1500); // now=3000
    const times = t.clicks.map((c) => c.atMs);
    expect(times).toContain(2075);
    expect(times).toContain(3075);
    expect(times).not.toContain(2575);
    // 마디 안 위치가 이어진다: 박 0,1,2,3 → 새 BPM 첫 박은 인덱스 2
    expect(t.clicks.find((c) => c.atMs === 2075)?.accent).toBe(false);
  });

  it('stop 후에는 더 예약하지 않는다', async () => {
    await t.m.start();
    t.advance(600);
    const n = t.clicks.length;
    t.m.stop();
    expect(t.m.state.playing).toBe(false);
    expect(t.isTicking()).toBe(false);
    t.tickNow();
    t.advance(2000);
    expect(t.clicks).toHaveLength(n);
    expect(t.m.nextBeat()).toBeNull();
  });

  it('starting 중 stop이 오면 resolve 후 idle로 돌아가고 예약하지 않는다', async () => {
    const m = new Metronome();
    let resolve!: () => void;
    const clicks: number[] = [];
    m.bind({
      click: (at) => (clicks.push(at), at),
      ensureAudio: () => new Promise<void>((r) => (resolve = r)),
      now: () => 0,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const p = m.start();
    m.stop();
    resolve();
    await p;
    expect(m.state.playing).toBe(false);
    expect(clicks).toHaveLength(0);
  });

  it('hidden이면 창이 HIDDEN_LOOKAHEAD_MS로 넓어진다', async () => {
    await t.m.start();
    t.setVisibility('hidden');
    t.m.handleVisibilityChange();
    // 현재 now=1000 → 창 끝 2200 → 박 1075, 1575, 2075 예약
    expect(t.clicks.map((c) => c.atMs)).toEqual([1075, 1575, 2075]);
    expect(HIDDEN_LOOKAHEAD_MS).toBe(1200);
  });

  it('visible 복귀 시 현재 박을 재동기 콜백으로 알린다', async () => {
    await t.m.start();
    t.advance(600); // now=1600, 현재 박은 인덱스 1(1575)
    t.setVisibility('hidden');
    t.setVisibility('visible');
    const got: number[] = [];
    t.m.onResync((b) => got.push(b));
    t.m.handleVisibilityChange();
    expect(got).toEqual([1]);
  });

  it('AudioContext가 running으로 복구되면 놓친 박을 버리고 버스트 없이 이어간다', async () => {
    await t.m.start();
    t.advance(200);
    const before = t.clicks.length;
    const nextIdx = t.m.nextBeat()!.index;
    // 오디오 중단 동안 5초가 흘렀다고 가정(틱은 돌지 않음)
    t.setNow(6000);
    t.audio('running');
    t.tickNow();
    t.advance(0);
    const added = t.clicks.slice(before);
    // 몰아서 울리지 않는다: 새 기준점(6075) 이전 시각의 박이 없다
    expect(added.every((c) => c.atMs >= 6075)).toBe(true);
    expect(added.length).toBeLessThanOrEqual(1);
    // 마디 안 위치가 이어진다
    expect(t.m.nextBeat()!.index).toBeGreaterThanOrEqual(nextIdx);
  });

  it('시작 직후 statechange(running)가 와도 예약된 박이 밀리지 않는다', async () => {
    await t.m.start();
    const planned = t.m.nextBeat()!.atMs;
    t.audio('running');
    expect(t.m.nextBeat()!.atMs).toBe(planned);
    t.advance(1100);
    const gaps = t.clicks.slice(1).map((c, i) => c.atMs - t.clicks[i].atMs);
    expect(gaps.every((g) => Math.abs(g - 500) < 1e-6)).toBe(true);
  });

  it('오디오 이벤트 없이 틱이 오래 멈췄다 돌아와도 놓친 박을 몰아 울리지 않는다', async () => {
    await t.m.start();
    t.advance(200);
    const before = t.clicks.length;
    t.setNow(6000);
    t.tickNow();
    const added = t.clicks.slice(before);
    expect(added.every((c) => c.atMs >= 6075)).toBe(true);
    expect(added.length).toBeLessThanOrEqual(1);
  });

  it('stats: drift = sink 반환값 − 계획 시각, late는 drift > 0인 박 수', async () => {
    const d = setup({ drift: 3 });
    await d.m.start();
    d.advance(1100);
    const s = d.m.stats;
    expect(s.scheduled).toBeGreaterThan(0);
    expect(s.late).toBe(s.scheduled);
    expect(s.maxDriftMs).toBe(3);
  });

  it('stats: 지연이 없으면 late 0, start마다 초기화', async () => {
    await t.m.start();
    t.advance(1100);
    expect(t.m.stats.late).toBe(0);
    expect(t.m.stats.maxDriftMs).toBe(0);
    expect(t.m.stats.scheduled).toBeGreaterThan(1);
    t.m.stop();
    await t.m.start();
    expect(t.m.stats.scheduled).toBe(1);
  });
});

describe('Metronome 설정·이벤트', () => {
  it('onChange는 playing·bpm·beatsPerBar 변경마다 스냅샷을 준다', async () => {
    const t = setup();
    const seen: unknown[] = [];
    t.m.onChange((s) => seen.push(s));
    t.m.setBpm(90);
    t.m.setBpm(90); // 같은 값은 무시
    t.m.setBeatsPerBar(3);
    await t.m.start();
    t.m.stop();
    expect(seen).toEqual([
      { playing: false, bpm: 90, beatsPerBar: 4, subdivision: 1, locked: false },
      { playing: false, bpm: 90, beatsPerBar: 3, subdivision: 1, locked: false },
      { playing: true, bpm: 90, beatsPerBar: 3, subdivision: 1, locked: false },
      { playing: false, bpm: 90, beatsPerBar: 3, subdivision: 1, locked: false },
    ]);
  });

  it('setBpm은 클램프하고 setBeatsPerBar는 3·4만 받는다', () => {
    const t = setup();
    t.m.setBpm(1000);
    expect(t.m.state.bpm).toBe(240);
    t.m.setBeatsPerBar(5);
    expect(t.m.state.beatsPerBar).toBe(4);
  });

  it('onBeat는 박이 예약될 때 BeatInfo를 주고 해제할 수 있다', async () => {
    const t = setup();
    const beats: number[] = [];
    const off = t.m.onBeat((b) => beats.push(b.index));
    await t.m.start();
    t.advance(600);
    expect(beats.slice(0, 2)).toEqual([0, 1]);
    off();
    const n = beats.length;
    t.advance(1000);
    expect(beats).toHaveLength(n);
  });

  it('tap은 탭 수를 돌려주고 2번째부터 BPM을 바꾼다', () => {
    const t = setup();
    expect(t.m.tap()).toBe(1);
    t.advance(400);
    expect(t.m.tap()).toBe(2);
    expect(t.m.state.bpm).toBe(150);
  });
});

describe('Metronome 잠금', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

    it('lock은 곡 값을 표시하고 자체 시계를 멈추며 조작을 무시한다', async () => {
      await t.m.start();
      t.m.setBpm(100);
      t.m.lock({ bpm: 120, beatsPerBar: 3 });
      expect(t.m.state).toEqual({ playing: false, bpm: 120, beatsPerBar: 3, subdivision: 1, locked: true });
      t.m.setBpm(200);
      t.m.setBeatsPerBar(4);
      t.m.toggle();
      await t.m.start();
      expect(t.m.state).toEqual({ playing: false, bpm: 120, beatsPerBar: 3, subdivision: 1, locked: true });
      const n = t.clicks.length;
      t.advance(1000);
      expect(t.clicks).toHaveLength(n);
    });

    it('3·4 외 박자는 4로 표시하고 원값을 보존한다', () => {
      t.m.lock({ bpm: 90, beatsPerBar: 6 });
      expect(t.m.state.beatsPerBar).toBe(4);
      expect(t.m.lockedBeatsPerBar).toBe(6);
    });

    it('unlock은 사용자 값으로 정지 상태 복귀하고 onChange를 낸다', async () => {
      t.m.setBpm(100);
      const states: boolean[] = [];
      t.m.onChange((s) => states.push(s.locked));
      t.m.lock({ bpm: 120, beatsPerBar: 4 });
      t.m.unlock();
      expect(t.m.state).toEqual({ playing: false, bpm: 100, beatsPerBar: 4, subdivision: 1, locked: false });
      expect(states).toEqual([true, false]);
    });

    it('pulse는 잠금 중 onBeat로 누적 index를 전달하고 잠금 아니면 무시한다', () => {
      const got: { index: number; beatInBar: number; accent: boolean; atMs: number }[] = [];
      t.m.onBeat((b) => got.push(b));
      t.m.pulse(0, 5);
      expect(got).toHaveLength(0);
      t.m.lock({ bpm: 120, beatsPerBar: 4 });
      t.m.pulse(0, 5000);
      t.m.pulse(1);
      expect(got[0]).toEqual({ index: 0, beatInBar: 0, accent: true, atMs: 5000 });
      expect(got[1]).toMatchObject({ index: 1, beatInBar: 1, accent: false, atMs: 1000 });
    });
});

describe('Metronome 박 분할 (설계 MODE-002-MODE-003-metronome-subdivision)', () => {
  const FIRST = 1000 + START_LEAD_MS; // 120BPM: 박 500ms, 사이 박 250ms

  it('8분이면 박마다 2번 울리고 사이 박은 정박 가운데, 박 리스너는 박마다 1번', async () => {
    const t = setup();
    const beats: number[] = [];
    t.m.onBeat((b) => beats.push(b.index));
    t.m.setSubdivision(2);
    expect(t.m.state.subdivision).toBe(2);
    await t.m.start();
    t.advance(2100);
    expect(t.clicks.slice(0, 9).map((c) => c.atMs)).toEqual([0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000].map((d) => FIRST + d));
    expect(t.levels.slice(0, 9)).toEqual(['accent', 'sub', 'beat', 'sub', 'beat', 'sub', 'beat', 'sub', 'accent']);
    expect(beats.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(t.m.stats.scheduled).toBe(t.clicks.length);
  });

  it('4분(기본)은 사이 박이 없다', async () => {
    const t = setup();
    await t.m.start();
    t.advance(2100);
    expect(t.m.state.subdivision).toBe(1);
    expect(t.levels).not.toContain('sub');
  });

  it('재생 중 4분 → 8분: 박 위치가 이어지고 예약돼 있던 다음 박부터 사이 박이 낀다', async () => {
    const t = setup();
    await t.m.start();
    t.advance(600); // 박 0(FIRST)·박 1(FIRST+500) 예약됨
    const before = t.clicks.length;
    t.m.setSubdivision(2);
    t.advance(1200);
    const after = t.clicks.slice(before);
    expect(after.slice(0, 3).map((c) => c.atMs)).toEqual([FIRST + 1000, FIRST + 1250, FIRST + 1500]);
    expect(t.levels.slice(before, before + 3)).toEqual(['beat', 'sub', 'beat']);
  });

  it('재생 중 8분 → 4분: 다음이 사이 박이어도 건너뛰고 다음 정박에서 이어진다', async () => {
    const t = setup();
    t.m.setSubdivision(2);
    await t.m.start();
    t.advance(100); // 틱 0만 예약, 다음은 사이 박(FIRST+250)
    expect(t.clicks).toHaveLength(1);
    t.m.setSubdivision(1);
    t.advance(1600);
    expect(t.clicks.slice(1, 4).map((c) => c.atMs)).toEqual([FIRST + 500, FIRST + 1000, FIRST + 1500]);
    expect(t.levels.slice(1)).not.toContain('sub');
  });

  it('8분에서 BPM을 바꿔도 다음 틱 시각이 그대로이고 그 뒤는 새 BPM의 반 박 간격, 마디 안 위치가 이어진다', async () => {
    const t = setup();
    t.m.setSubdivision(2);
    await t.m.start();
    t.advance(100); // 다음 틱 = 사이 박(0.5박, FIRST+250)
    t.m.setBpm(60); // 박 1000ms, 사이 박 500ms
    expect(t.m.currentBeat()).toBe(-1); // 새 기준점 전에는 -1(4분에서의 기존 동작과 같음)
    t.advance(1400);
    expect(t.clicks.slice(1, 4).map((c) => c.atMs)).toEqual([FIRST + 250, FIRST + 750, FIRST + 1250]);
    expect(t.levels.slice(1, 4)).toEqual(['sub', 'beat', 'sub']);
    expect(t.m.currentBeat()).toBe(1); // now = 2500, 1박(FIRST+750) 지남
  });

  it('값이 같으면 변경 알림이 없고, 다르면 한 번 알린다(잠금 중에도 값은 받는다)', () => {
    const t = setup();
    const seen: number[] = [];
    t.m.onChange((s) => seen.push(s.subdivision));
    t.m.setSubdivision(1);
    expect(seen).toEqual([]);
    t.m.setSubdivision(2);
    expect(seen).toEqual([2]);
    t.m.lock({ bpm: 72, beatsPerBar: 4 });
    t.m.setSubdivision(1);
    expect(t.m.state).toMatchObject({ locked: true, subdivision: 1 });
  });

  it('탭이 가려져 넓은 창으로 예약해도 8분 틱이 빠지거나 겹치지 않는다', async () => {
    const t = setup();
    t.m.setSubdivision(2);
    await t.m.start();
    t.setVisibility('hidden');
    t.tickNow();
    t.advance(3000);
    const at = t.clicks.map((c) => c.atMs);
    at.forEach((v, i) => expect(v).toBe(FIRST + i * 250));
    expect(new Set(at).size).toBe(at.length);
  });
});
