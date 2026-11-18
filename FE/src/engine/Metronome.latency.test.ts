// 전역 메트로놈이 출력 지연이 클 때도 클릭을 늦지 않게 예약하는지(설계 MODE-001 "같은 원인의 나머지 예약 경로").
// 모의 엔진: 화면 시계 시각 w에 들리게 하려는 클릭은 w가 now + 앞선 정도보다 이르면 now + 앞선 정도로 당겨진다(AudioEngine.click과 같은 동작).
import { describe, expect, it } from 'vitest';
import { Metronome, TICK_MS } from './Metronome';

function setup(ahead: (now: number) => number, useAhead = true) {
  let now = 1000;
  let tickFn: (() => void) | null = null;
  let audioListener: ((state: string) => void) | null = null;
  const heard: number[] = [];
  const asked: number[] = [];
  const m = new Metronome();
  m.bind({
    click: (atMs) => {
      asked.push(atMs);
      const at = Math.max(atMs, now + ahead(now));
      heard.push(at);
      return at;
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
    visibility: () => 'visible',
    onAudioState: (l) => {
      audioListener = l;
    },
    ...(useAhead ? { renderAheadMs: () => ahead(now) } : {}),
  });
  return {
    m,
    heard,
    asked,
    advance(ms: number) {
      for (let t = 0; t < ms; t += TICK_MS) {
        now += TICK_MS;
        tickFn?.();
      }
    },
    jump(ms: number) {
      now += ms;
    },
    audio: (s: string) => audioListener?.(s),
  };
}

const intervals = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);

describe('Metronome 출력 지연', () => {
  it.each([0, 40, 120, 450, 800])('앞선 정도 %ims: 클릭이 하나도 늦지 않고 간격이 정확히 박 간격', async (ms) => {
    const t = setup(() => ms);
    t.m.setBpm(100);
    await t.m.start();
    t.advance(30_000);
    expect(t.heard.length).toBeGreaterThan(40);
    t.heard.forEach((h, i) => expect(h).toBeCloseTo(t.asked[i], 9));
    for (const d of intervals(t.heard)) expect(d).toBeCloseTo(600, 9);
  });

  it('앞선 정도를 안 더하면(예전) 450ms에서 클릭이 늦게 울린다', async () => {
    const t = setup(() => 450, false);
    t.m.setBpm(100);
    await t.m.start();
    t.advance(10_000);
    const late = t.heard.map((h, i) => h - t.asked[i]);
    expect(Math.min(...late)).toBeGreaterThan(300);
  });

  it('곡 도중 앞선 정도가 80ms → 680ms로 커져도 늦는 클릭이 없다', async () => {
    let start = 0;
    const t = setup((now) => 80 + Math.min(600, Math.max(0, now - start) / 100));
    start = 1000;
    t.m.setBpm(120);
    await t.m.start();
    t.advance(60_000);
    t.heard.forEach((h, i) => expect(h).toBeCloseTo(t.asked[i], 9));
    for (const d of intervals(t.heard)) expect(d).toBeCloseTo(500, 9);
  });

  it('bpm을 바꿔도 늦는 클릭이 없다', async () => {
    const t = setup(() => 450);
    t.m.setBpm(100);
    await t.m.start();
    t.advance(5_000);
    t.m.setBpm(140);
    t.advance(5_000);
    t.heard.forEach((h, i) => expect(h).toBeCloseTo(t.asked[i], 9));
  });

  it('타이머가 멈췄다 돌아와도(복구 기준점) 늦는 클릭이 없다', async () => {
    const t = setup(() => 450);
    t.m.setBpm(100);
    await t.m.start();
    t.advance(3_000);
    t.jump(5_000);
    t.audio('running');
    t.advance(3_000);
    t.heard.forEach((h, i) => expect(h).toBeCloseTo(t.asked[i], 9));
  });
});
