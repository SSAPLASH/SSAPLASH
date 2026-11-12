// 박자 맞추기 계산 검증: 짝짓기, 중앙값·흩어짐, 결과 판정, 저장값 반올림·범위.
import { describe, expect, it } from 'vitest';
import {
  clampTimingOffset,
  evaluateTimingCal,
  pairTaps,
  timingCalBeatMs,
  TIMING_CAL_MEASURE_BEATS,
  TIMING_CAL_MIN_PAIRS,
  TIMING_OFFSET_MAX_MS,
  TIMING_OFFSET_MIN_MS,
  type TimingCalTap,
} from './timingCalibration';
import { RhythmSession } from '@/engine/RhythmSession';
import type { Chart } from '../chart';
import type { ResolvedHit } from '../events';

const BEAT = timingCalBeatMs();
/** 측정 박 12개. 첫 측정 박이 10_000ms */
const beats = Array.from({ length: TIMING_CAL_MEASURE_BEATS }, (_, i) => 10_000 + i * BEAT);
const tap = (tHit: number, input: TimingCalTap['input'] = 'sensor'): TimingCalTap => ({ tHit, input });

describe('clampTimingOffset', () => {
  it('5ms 단위로 반올림한다', () => {
    expect(clampTimingOffset(-67.4)).toBe(-65);
    expect(clampTimingOffset(-67.6)).toBe(-70);
    expect(clampTimingOffset(2)).toBe(0);
    expect(Object.is(clampTimingOffset(-2), 0)).toBe(true);
  });

  it('범위 밖은 자르고 숫자가 아니면 0', () => {
    expect(clampTimingOffset(-400)).toBe(TIMING_OFFSET_MIN_MS);
    expect(clampTimingOffset(150)).toBe(TIMING_OFFSET_MAX_MS);
    expect(clampTimingOffset(Number.NaN)).toBe(0);
  });
});

describe('pairTaps', () => {
  it('한 박에 타격이 둘이면 가까운 하나만 쓴다', () => {
    const paired = pairTaps([1000], [tap(900), tap(990), tap(1200)]);
    expect(paired).toHaveLength(1);
    expect(paired[0].deltaMs).toBe(-10);
  });

  it('폭(±250ms) 밖 타격은 짝짓지 않는다', () => {
    expect(pairTaps([1000], [tap(700), tap(1300)])).toHaveLength(0);
  });
});

describe('evaluateTimingCal', () => {
  it('박마다 65ms 일찍 치면 −65ms가 나온다', () => {
    const r = evaluateTimingCal(beats, beats.map((b) => tap(b - 65)));
    expect(r.status).toBe('ok');
    expect(r.pairs).toBe(12);
    expect(r.medianMs).toBe(-65);
    expect(r.madMs).toBe(0);
    expect(r.offsetMs).toBe(-65);
    expect(r.input).toBe('sensor');
  });

  it('그 값으로 만든 세션에서 같은 타격의 delta가 ±3ms 안이다', () => {
    const r = evaluateTimingCal(beats, beats.map((b, i) => tap(b - 65 + ((i % 3) - 1) * 4)));
    expect(r.status).toBe('ok');
    const chart: Chart = { songId: 't', title: 't', bpm: 100, beatsPerBar: 4, notes: [{ timeMs: 1000, pad: 'SNARE' }] } as Chart;
    const ss = new RhythmSession(chart, { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 0, audioOffsetMs: r.offsetMs as number });
    ss.start(5000);
    const ev = ss.handleHit({ id: 1, pad: 'SNARE', velocity: 100, tHit: 5000 + 1000 - 65, source: 'serial', stickId: 0 } as ResolvedHit);
    expect(Math.abs(ev?.deltaMs ?? 99)).toBeLessThanOrEqual(3);
  });

  it('듣기 구간 타격은 계산에 들어가지 않는다', () => {
    // 듣기 박(측정 박보다 앞)에 크게 늦게 친 타격 4개. 측정 박과 폭 밖이라 빠진다
    const listen = [0, 1, 2, 3].map((i) => tap(beats[0] - (4 - i) * BEAT + 200));
    const r = evaluateTimingCal(beats, [...listen, ...beats.map((b) => tap(b - 40))]);
    expect(r.pairs).toBe(12);
    expect(r.medianMs).toBe(-40);
  });

  it('짝이 모자라면 표본 부족이고 저장값이 없다', () => {
    const r = evaluateTimingCal(beats, beats.slice(0, TIMING_CAL_MIN_PAIRS - 1).map((b) => tap(b - 60)));
    expect(r.status).toBe('few');
    expect(r.pairs).toBe(TIMING_CAL_MIN_PAIRS - 1);
    expect(r.offsetMs).toBeNull();
  });

  it('타격이 하나도 없으면 표본 부족', () => {
    expect(evaluateTimingCal(beats, [])).toEqual({ status: 'few', pairs: 0, medianMs: null, madMs: null, offsetMs: null, input: null });
  });

  it('흩어짐이 25ms를 넘으면 다시 하게 하고 저장값이 없다', () => {
    // 어긋남이 −120과 0을 번갈아: 중앙값 −60, 흩어짐 60
    const r = evaluateTimingCal(beats, beats.map((b, i) => tap(b - (i % 2 ? 120 : 0))));
    expect(r.status).toBe('scattered');
    expect(r.madMs).toBe(60);
    expect(r.offsetMs).toBeNull();
  });

  it('흩어짐이 한도 이하면 성공이다', () => {
    // 어긋남 −90 / −40 번갈아: 중앙값 −65, 흩어짐 25
    const r = evaluateTimingCal(beats, beats.map((b, i) => tap(b - (i % 2 ? 90 : 40))));
    expect(r.status).toBe('ok');
    expect(r.madMs).toBe(25);
    expect(r.offsetMs).toBe(-65);
  });

  it('측정에 쓴 입력은 짝지어진 타격의 다수로 정한다', () => {
    const r = evaluateTimingCal(beats, beats.map((b, i) => tap(b - 20, i < 9 ? 'keyboard' : 'sensor')));
    expect(r.input).toBe('keyboard');
  });

  it('범위를 넘는 중앙값은 범위 끝으로 저장한다', () => {
    const r = evaluateTimingCal(beats, beats.map((b) => tap(b - 249)));
    expect(r.status).toBe('ok');
    expect(r.offsetMs).toBe(TIMING_OFFSET_MIN_MS);
  });
});
