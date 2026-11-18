import { describe, expect, it } from 'vitest';
import { barTimeMs, beatAtMs, beatTimeMs, tempoSegmentsFrom } from './tempo';

// 원점 1000ms, 0~8박은 120bpm(박 500ms), 8박부터 60bpm(박 1000ms)
const segs = tempoSegmentsFrom(1000, 480, [
  { tick: 0, bpm: 120 },
  { tick: 3840, bpm: 60 },
])!;
const chart = { bpm: 120, offsetMs: 1000, beatsPerBar: 4, tempoSegments: segs };

describe('tempoSegmentsFrom', () => {
  it('틱을 BE milliseconds와 같은 식으로 곡 시각으로 바꾼다', () => {
    expect(segs).toEqual([
      { beat: 0, startMs: 1000, bpm: 120 },
      { beat: 8, startMs: 5000, bpm: 60 },
    ]);
  });

  it('구간이 하나거나 ppq가 없거나 틱이 이상하면 undefined', () => {
    expect(tempoSegmentsFrom(0, 480, [{ tick: 0, bpm: 120 }])).toBeUndefined();
    expect(tempoSegmentsFrom(0, null, [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 90 }])).toBeUndefined();
    expect(tempoSegmentsFrom(0, 480, [{ tick: 0, bpm: 120 }, { tick: 0, bpm: 90 }])).toBeUndefined();
    expect(tempoSegmentsFrom(0, 480, [{ tick: 480, bpm: 120 }, { tick: 960, bpm: 90 }])).toBeUndefined();
  });
});

describe('beatTimeMs', () => {
  it('구간마다 그 구간 bpm으로 센다', () => {
    expect(beatTimeMs(chart, 0)).toBe(1000);
    expect(beatTimeMs(chart, 4)).toBe(3000);
    expect(beatTimeMs(chart, 8)).toBe(5000);
    expect(beatTimeMs(chart, 9)).toBe(6000);
    expect(barTimeMs(chart, 3)).toBe(9000);
  });

  it('원점 앞(카운트인)은 첫 bpm으로 거꾸로 센다', () => {
    expect(beatTimeMs(chart, -4)).toBe(-1000);
  });

  it('빠르기 구간이 없으면 기존 고정 간격과 같다', () => {
    const fixed = { bpm: 120, offsetMs: 250 };
    for (let i = -8; i < 40; i++) expect(beatTimeMs(fixed, i)).toBe(250 + i * 500);
  });

  it('beatAtMs는 역함수', () => {
    for (const b of [-3, 0, 2.5, 7.9, 8, 11.25]) expect(beatAtMs(chart, beatTimeMs(chart, b))).toBeCloseTo(b, 9);
  });
});
