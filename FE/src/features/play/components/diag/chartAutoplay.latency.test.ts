// 채보 자동 재생이 출력 지연이 클 때도 소리를 늦지 않게 예약하는지(설계 MODE-001 "같은 원인의 나머지 예약 경로").
// 모의 엔진: 화면 시계 시각 at에 들리게 하려는 소리는 at이 now + 앞선 정도보다 이르면 now + 앞선 정도로 당겨진다(AudioEngine.fire와 같은 동작).
import { describe, expect, it } from 'vitest';
import { createChartAutoplay, AUTOPLAY_TICK_MS } from './chartAutoplay';
import type { ChartNote } from '@/domain/song/chart';

const NOTES: ChartNote[] = Array.from({ length: 80 }, (_, i) => ({ timeMs: 500 + i * 125, pad: i % 2 === 0 ? 'KICK' : 'HIHAT', velocityHint: 90 }));

/** 실제 연주처럼 곡 0ms 전에 리드인이 있다(카운트다운 3초 + 카운트인 1마디). 곡 시각 = now − LEAD_IN */
const LEAD_IN = 5000;

function setup(ahead: number, useAhead = true) {
  let now = 0;
  const asked: number[] = [];
  const heard: number[] = [];
  let fn: (() => void) | null = null;
  const ap = createChartAutoplay({
    notes: NOTES,
    songTime: () => now - LEAD_IN,
    play: (_pad, _v, at) => {
      asked.push(at);
      heard.push(Math.max(at, now + ahead));
    },
    now: () => now,
    setInterval: (f) => {
      fn = f;
      return 1;
    },
    clearInterval: () => {
      fn = null;
    },
    visibility: () => 'visible',
    ...(useAhead ? { renderAheadMs: () => ahead } : {}),
  });
  return {
    ap,
    asked,
    heard,
    advance(ms: number) {
      const end = now + ms;
      while (now < end) {
        now += AUTOPLAY_TICK_MS;
        fn?.();
      }
    },
  };
}

describe('chartAutoplay 출력 지연', () => {
  it.each([0, 40, 250, 450, 800])('앞선 정도 %ims: 노트 소리가 하나도 늦지 않고 노트 시각 그대로 들린다', (ms) => {
    const t = setup(ms);
    t.ap.start();
    t.advance(20_000);
    expect(t.heard).toHaveLength(NOTES.length);
    t.heard.forEach((h, i) => {
      expect(h).toBeCloseTo(t.asked[i], 9);
      // 곡 시각 = now − LEAD_IN이므로 들리는 시각 = 노트 시각 + LEAD_IN
      expect(h).toBeCloseTo(NOTES[i].timeMs + LEAD_IN, 9);
    });
  });

  it('앞선 정도를 안 더하면(예전) 450ms에서 소리가 늦게 들린다', () => {
    const t = setup(450, false);
    t.ap.start();
    t.advance(20_000);
    expect(Math.min(...t.heard.map((h, i) => h - t.asked[i]))).toBeGreaterThan(200);
  });
});

describe('chartAutoplay 탭 가림', () => {
  it('가려지는 순간 넓은 창으로 예약해 타이머가 1초 늦어져도 노트를 놓치거나 늦지 않는다(앞선 정도 450ms)', () => {
    let now = 0;
    let hidden = false;
    const heard: number[] = [];
    const asked: number[] = [];
    const h: { fn: (() => void) | null; vis: (() => void) | null } = { fn: null, vis: null };
    const ap = createChartAutoplay({
      notes: NOTES,
      songTime: () => now - LEAD_IN,
      play: (_p, _v, at) => {
        asked.push(at);
        heard.push(Math.max(at, now + 450));
      },
      now: () => now,
      setInterval: (f) => {
        h.fn = f;
        return 1;
      },
      clearInterval: () => {
        h.fn = null;
      },
      visibility: () => (hidden ? 'hidden' : 'visible'),
      renderAheadMs: () => 450,
      onVisibilityChange: (f) => {
        h.vis = f;
        return () => {
          h.vis = null;
        };
      },
    });
    ap.start();
    const hideAt = LEAD_IN + 1510;
    while (now < 20_000) {
      now += AUTOPLAY_TICK_MS;
      if (!hidden && now >= hideAt) {
        hidden = true;
        h.vis?.();
      }
      if (!hidden || (now - hideAt) % 1000 < AUTOPLAY_TICK_MS) h.fn?.();
    }
    expect(heard).toHaveLength(NOTES.length);
    heard.forEach((x, i) => expect(x).toBeCloseTo(asked[i], 9));
  });
});
