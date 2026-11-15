import { describe, expect, it } from 'vitest';
import type { Chart } from './chart';
import { isPracticeRate, rateHint, rateLabel, ratePercent, sanitizeRate, scaleChart, slowRateOf, stepRate, toSongMs } from './practiceRate';

const chart: Chart = {
  songId: 't',
  title: '시험곡',
  difficulty: 'EASY',
  bpm: 120,
  offsetMs: 500,
  beatsPerBar: 4,
  notes: [
    { timeMs: 500, pad: 'KICK', noteId: 'a' },
    { timeMs: 1000, pad: 'SNARE', noteId: 'b' },
    { timeMs: 7000, pad: 'HIHAT', hihatOpen: true, noteId: 'c' },
  ],
  source: 'BUILTIN',
  durationMs: 8000,
  chartVersionId: 11,
  chartId: 3,
  songNumericId: 1,
};

describe('연습 속도 배율', () => {
  it('50~100 %의 5 % 단위만 받는다', () => {
    for (const v of [0.5, 0.55, 0.7, 0.85, 0.95, 1]) expect(isPracticeRate(v)).toBe(true);
    for (const v of [0.45, 0.52, 0.701, 1.05, 0, NaN, '0.7', null, undefined]) expect(isPracticeRate(v)).toBe(false);
    expect(sanitizeRate(0.7)).toBe(0.7);
    expect(sanitizeRate(0.3)).toBe(1);
    expect(sanitizeRate(undefined)).toBe(1);
  });

  it('한 단계는 5 %이고 양 끝에서 멈춘다. 소수 오차가 쌓이지 않는다', () => {
    let r = 1;
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      r = stepRate(r, -1);
      seen.push(ratePercent(r));
    }
    expect(seen).toEqual([95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 50, 50]);
    expect(r).toBe(0.5);
    expect(stepRate(0.95, 1)).toBe(1);
    expect(stepRate(1, 1)).toBe(1);
    expect(stepRate(0.55, 1)).toBe(0.6);
  });

  it('느리게 친 판의 배율만 꺼낸다: 0 초과 1 미만이면 그 값, 없음·1·이상한 값은 null', () => {
    expect(slowRateOf(0.7)).toBe(0.7);
    expect(slowRateOf(0.62)).toBe(0.62);
    for (const v of [1, undefined, null, 0, -0.5, 1.5, NaN, '0.7']) expect(slowRateOf(v)).toBeNull();
  });

  it('표시 문구: 배율과 실제 BPM', () => {
    expect(rateLabel(0.7)).toBe('70%');
    expect(rateLabel(1)).toBe('100%');
    expect(rateHint(120, 0.7)).toBe('BPM 120 → 84');
    expect(rateHint(128, 0.7)).toBe('BPM 128 → 90');
    expect(rateHint(78.43, 0.5)).toBe('BPM 78 → 39');
    expect(rateHint(120, 1)).toBe('원래 빠르기');
  });
});

describe('scaleChart', () => {
  it('배율 1(과 이상한 값)이면 받은 채보 그대로다', () => {
    expect(scaleChart(chart, 1)).toBe(chart);
    expect(scaleChart(chart, 0.33)).toBe(chart);
  });

  it('시각은 배율로 나누고 BPM에는 배율을 곱한다. 노트 수·순서·패드·id는 그대로다', () => {
    const slow = scaleChart(chart, 0.5);
    expect(slow.bpm).toBe(60);
    expect(slow.offsetMs).toBe(1000);
    expect(slow.durationMs).toBe(16000);
    expect(slow.notes.map((n) => n.timeMs)).toEqual([1000, 2000, 14000]);
    expect(slow.notes.map((n) => [n.pad, n.noteId])).toEqual([['KICK', 'a'], ['SNARE', 'b'], ['HIHAT', 'c']]);
    expect(slow.notes[2].hihatOpen).toBe(true);
    expect(slow).toMatchObject({ beatsPerBar: 4, chartVersionId: 11, chartId: 3, songNumericId: 1, title: '시험곡' });
    // 받은 채보는 건드리지 않는다
    expect(chart.notes[0].timeMs).toBe(500);
    expect(chart.playbackRate).toBeUndefined();
  });

  it('원래 값을 노트와 채보에 남긴다(기록을 곡 시각으로 되돌리는 데 쓴다)', () => {
    const slow = scaleChart(chart, 0.7);
    expect(slow.playbackRate).toBe(0.7);
    expect(slow.sourceTiming).toEqual({ durationMs: 8000, bpm: 120, offsetMs: 500 });
    expect(slow.notes.map((n) => n.sourceTimeMs)).toEqual([500, 1000, 7000]);
    // 늘린 시각 × 배율 ≈ 원래 시각
    slow.notes.forEach((n) => expect(toSongMs(n.timeMs, 0.7)).toBeCloseTo(n.sourceTimeMs!, 6));
    expect(slow.bpm).toBeCloseTo(84, 9);
  });

  it('빠르기 구간도 시각·BPM이 같이 바뀌고 박 번호는 그대로다', () => {
    const tempo: Chart = {
      ...chart,
      offsetMs: 0,
      tempoSegments: [
        { beat: 0, startMs: 0, bpm: 120 },
        { beat: 4, startMs: 2000, bpm: 60 },
      ],
    };
    expect(scaleChart(tempo, 0.5).tempoSegments).toEqual([
      { beat: 0, startMs: 0, bpm: 60 },
      { beat: 4, startMs: 4000, bpm: 30 },
    ]);
    expect(scaleChart(chart, 0.5).tempoSegments).toBeUndefined();
  });

  it('곡 시각 되돌리기: 배율 1이면 그대로', () => {
    expect(toSongMs(1234.5, 1)).toBe(1234.5);
    expect(toSongMs(1000, 0.7)).toBeCloseTo(700, 9);
  });
});
