import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_SKEW_WINDOW_MS,
  clockSkewText,
  evaluateArrivalSkew,
  skewedDevices,
  type ArrivalDevice,
  type ArrivalSample,
  type ClockSkew,
} from './arrivalSkew';

const NOW = 100_000;

/** NOW 직전 구간에 같은 지연 표본 n개 */
const lags = (lag: number, n: number): ArrivalSample[] =>
  Array.from({ length: n }, (_, i) => ({ at: NOW - 1000 - i * 10, lagMs: lag }));

const none: Record<ArrivalDevice, ArrivalSample[]> = { left: [], right: [], pedal: [] };

describe('evaluateArrivalSkew', () => {
  it('표본이 5개 미만인 기기는 비교에서 빠지고, 유효 기기가 둘 미만이면 null', () => {
    expect(evaluateArrivalSkew({ ...none, left: lags(10, 4), right: lags(10, 9) }, NOW)).toBeNull();
    expect(evaluateArrivalSkew({ ...none, left: lags(10, 5), right: lags(10, 9) }, NOW)).not.toBeNull();
  });

  it('30초 밖 표본은 세지 않는다', () => {
    const old: ArrivalSample[] = Array.from({ length: 8 }, (_, i) => ({ at: NOW - ARRIVAL_SKEW_WINDOW_MS - 1 - i, lagMs: 50 }));
    expect(evaluateArrivalSkew({ ...none, left: old, right: lags(10, 9) }, NOW)).toBeNull();
  });

  it('spread는 유효 기기 중앙값의 최대 − 최소이고, 표본 부족 기기의 중앙값은 null', () => {
    const skew = evaluateArrivalSkew({ ...none, left: lags(10, 9), right: lags(25, 9), pedal: lags(99, 2) }, NOW)!;
    expect(skew.spreadMs).toBe(15);
    expect(skew.medians).toEqual({ left: 10, right: 25, pedal: null });
  });

  it('중앙값을 쓰므로 튀는 표본 하나에 흔들리지 않는다', () => {
    const left = [...lags(10, 8), { at: NOW - 500, lagMs: 500 }];
    const skew = evaluateArrivalSkew({ ...none, left, right: lags(10, 9) }, NOW)!;
    expect(skew.spreadMs).toBe(0);
  });

  it('세 기기에서 왼손만 +40ms 어긋나면 outlier는 left', () => {
    const skew = evaluateArrivalSkew({ left: lags(50, 9), right: lags(10, 9), pedal: lags(10, 9) }, NOW)!;
    expect(skew.spreadMs).toBe(40);
    expect(skew.outlier).toBe('left');
  });

  it('두 기기만 있으면 가르지 못해 outlier는 null', () => {
    const skew = evaluateArrivalSkew({ ...none, left: lags(50, 9), right: lags(10, 9) }, NOW)!;
    expect(skew.outlier).toBeNull();
  });
});

describe('skewedDevices', () => {
  it('outlier가 있으면 그 기기 하나', () => {
    const s: ClockSkew = { spreadMs: 40, medians: { left: 50, right: 10, pedal: 10 }, outlier: 'left' };
    expect(skewedDevices(s)).toEqual(['left']);
  });

  it('outlier가 없으면 비교에 들어간 기기 전부', () => {
    const s: ClockSkew = { spreadMs: 40, medians: { left: 50, right: 10, pedal: null }, outlier: null };
    expect(skewedDevices(s)).toEqual(['left', 'right']);
  });
});

describe('clockSkewText', () => {
  const spreadMs = 40;
  it('어긋난 기기가 하나로 가려지면 그 기기를 말한다', () => {
    expect(clockSkewText({ spreadMs, medians: { left: 50, right: 10, pedal: 10 }, outlier: 'left' })).toBe('왼손 스틱 시간이 어긋났어요. 껐다 켜 주세요.');
    expect(clockSkewText({ spreadMs, medians: { left: 10, right: 50, pedal: 10 }, outlier: 'right' })).toBe('오른손 스틱 시간이 어긋났어요. 껐다 켜 주세요.');
    expect(clockSkewText({ spreadMs, medians: { left: 10, right: 10, pedal: 50 }, outlier: 'pedal' })).toBe('페달 시간이 어긋났어요. 껐다 켜 주세요.');
  });

  it('가르지 못하면 비교 기기에 따라 두 손 / 스틱과 페달 문구', () => {
    expect(clockSkewText({ spreadMs, medians: { left: 50, right: 10, pedal: null }, outlier: null })).toBe('스틱 시간이 서로 어긋났어요. 스틱을 껐다 켜 주세요.');
    expect(clockSkewText({ spreadMs, medians: { left: 50, right: null, pedal: 10 }, outlier: null })).toBe('스틱과 페달 시간이 서로 어긋났어요. 껐다 켜 주세요.');
  });
});
