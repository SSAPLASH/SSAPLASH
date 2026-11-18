// 박자 맞추기 문구 검증: 결과·기록·상태·입력 불일치·출력 지연 안내.
import { describe, expect, it } from 'vitest';
import { OUTPUT_LATENCY_WARN_MS, type TimingCalRecord, type TimingCalResult } from '@/domain/kit/calibration/timingCalibration';
import {
  outputLatencyWarnText,
  timingCalMismatchText,
  timingCalResultText,
  timingCalStatusText,
  timingOffsetText,
} from './timingCalText';

const result = (over: Partial<TimingCalResult>): TimingCalResult => ({ status: 'ok', pairs: 12, medianMs: -66.4, madMs: 8, offsetMs: -65, input: 'sensor', ...over });
const rec: TimingCalRecord = { measuredAt: new Date(2026, 10, 11, 18, 0).getTime(), medianMs: -66, madMs: 8, pairs: 12, input: 'sensor', outputLatencyMs: 40, kick: null };

describe('timingOffsetText', () => {
  it('양수에만 부호를 붙인다', () => {
    expect(timingOffsetText(20)).toBe('+20ms');
    expect(timingOffsetText(0)).toBe('0ms');
    expect(timingOffsetText(-65)).toBe('-65ms');
  });
});

describe('timingCalResultText', () => {
  it('성공이면 이르게·늦게 친 정도를 말한다', () => {
    expect(timingCalResultText(result({}))).toBe('클릭보다 평균 66ms 일찍 쳤어요.');
    expect(timingCalResultText(result({ medianMs: 12.2 }))).toBe('클릭보다 평균 12ms 늦게 쳤어요.');
    expect(timingCalResultText(result({ medianMs: 0.3 }))).toBe('클릭과 거의 같은 순간에 쳤어요.');
  });

  it('실패면 이유를 말한다', () => {
    expect(timingCalResultText(result({ status: 'few', pairs: 3, offsetMs: null }))).toContain('3번뿐');
    expect(timingCalResultText(result({ status: 'scattered', offsetMs: null }))).toContain('타이밍 차이가 커서');
  });
});

describe('기록·상태 문구', () => {
  it('드럼 세팅 상태 줄', () => {
    expect(timingCalStatusText(null, 0)).toBe('안 맞춤');
    expect(timingCalStatusText(rec, -65)).toBe('맞춤 · -65ms');
    expect(timingCalStatusText(rec, -65, null)).toBe('맞춤 · -65ms');
    expect(timingCalStatusText(rec, -65, -40)).toBe('맞춤 · 스틱 -65ms · 킥 -40ms');
    expect(timingCalStatusText(null, 0, -40)).toBe('안 맞춤');
  });

  it('측정한 입력과 지금 입력이 다를 때만 다시 맞추라고 안내한다', () => {
    expect(timingCalMismatchText(null, true)).toBeNull();
    expect(timingCalMismatchText(rec, true)).toBeNull();
    expect(timingCalMismatchText(rec, false)).toBe('스틱으로 맞춘 값이에요. 키보드로 칠 때는 다시 맞춰 주세요.');
    expect(timingCalMismatchText({ ...rec, input: 'keyboard' }, true)).toBe('키보드로 맞춘 값이에요. 스틱으로 칠 때는 다시 맞춰 주세요.');
  });
});

describe('outputLatencyWarnText', () => {
  it('문턱을 넘을 때만 유선 출력을 권한다', () => {
    expect(outputLatencyWarnText(null)).toBeNull();
    expect(outputLatencyWarnText(OUTPUT_LATENCY_WARN_MS)).toBeNull();
    expect(outputLatencyWarnText(OUTPUT_LATENCY_WARN_MS + 80.4)).toContain('180ms 늦게');
  });
});
