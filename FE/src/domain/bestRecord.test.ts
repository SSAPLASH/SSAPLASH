import { describe, expect, it } from 'vitest';
import type { PlayLog } from '@/engine/playLog';
import { bestAccuracyByChart, bestScoreBySong } from './bestRecord';

/** 필요한 필드만 채운 로그 */
function log(p: {
  mode?: PlayLog['mode'];
  song?: number | null;
  chart?: number | null;
  score?: number;
  accuracy?: number;
}): PlayLog {
  return {
    mode: p.mode ?? 'RHYTHM',
    songNumericId: p.song === undefined ? null : p.song,
    chartId: p.chart === undefined ? null : p.chart,
    summary: { score: p.score ?? 0, accuracy: p.accuracy ?? 0 },
  } as unknown as PlayLog;
}

describe('bestScoreBySong', () => {
  it('빈 입력이면 빈 Map', () => {
    expect(bestScoreBySong([], 'RHYTHM').size).toBe(0);
  });

  it('곡별 최고 점수를 뽑는다', () => {
    const m = bestScoreBySong(
      [log({ song: 1, score: 100 }), log({ song: 1, score: 300 }), log({ song: 2, score: 50 }), log({ song: 1, score: 200 })],
      'RHYTHM',
    );
    expect(m.get(1)).toBe(300);
    expect(m.get(2)).toBe(50);
  });

  it('같은 곡의 여러 연습 단계(채보) 중 가장 높은 점수', () => {
    const m = bestScoreBySong(
      [log({ song: 1, chart: 10, score: 120 }), log({ song: 1, chart: 11, score: 900 }), log({ song: 1, chart: 12, score: 400 })],
      'RHYTHM',
    );
    expect(m.get(1)).toBe(900);
  });

  it('모드별로 분리한다(RHYTHM·SHEET)', () => {
    const logs = [log({ mode: 'RHYTHM', song: 1, score: 100 }), log({ mode: 'SHEET', song: 1, score: 999 })];
    expect(bestScoreBySong(logs, 'RHYTHM').get(1)).toBe(100);
    expect(bestScoreBySong(logs, 'SHEET').get(1)).toBe(999);
    expect(bestScoreBySong(logs, 'FREE').size).toBe(0);
  });

  it('곡 id 없는 로그(내장 채보)는 건너뛴다', () => {
    const m = bestScoreBySong([log({ song: null, score: 500 }), log({ song: 3, score: 10 })], 'RHYTHM');
    expect([...m.keys()]).toEqual([3]);
  });

  it('유한하지 않은 점수는 건너뛴다', () => {
    const m = bestScoreBySong([log({ song: 1, score: Number.NaN }), log({ song: 1, score: 5 })], 'RHYTHM');
    expect(m.get(1)).toBe(5);
  });

  it('0점도 기록으로 센다', () => {
    expect(bestScoreBySong([log({ song: 1, score: 0 })], 'RHYTHM').get(1)).toBe(0);
  });
});

describe('bestAccuracyByChart', () => {
  it('빈 입력이면 빈 Map', () => {
    expect(bestAccuracyByChart([], 'RHYTHM').size).toBe(0);
  });

  it('채보별 최고 정확도를 뽑는다', () => {
    const m = bestAccuracyByChart(
      [log({ chart: 10, accuracy: 0.5 }), log({ chart: 10, accuracy: 0.9 }), log({ chart: 11, accuracy: 0.7 }), log({ chart: 10, accuracy: 0.8 })],
      'RHYTHM',
    );
    expect(m.get(10)).toBe(0.9);
    expect(m.get(11)).toBe(0.7);
  });

  it('모드별로 분리한다(RHYTHM·SHEET)', () => {
    const logs = [log({ mode: 'RHYTHM', chart: 10, accuracy: 0.4 }), log({ mode: 'SHEET', chart: 10, accuracy: 0.95 })];
    expect(bestAccuracyByChart(logs, 'RHYTHM').get(10)).toBe(0.4);
    expect(bestAccuracyByChart(logs, 'SHEET').get(10)).toBe(0.95);
  });

  it('채보 id 없는 로그는 건너뛴다', () => {
    const m = bestAccuracyByChart([log({ chart: null, accuracy: 1 }), log({ chart: 2, accuracy: 0.3 })], 'RHYTHM');
    expect([...m.keys()]).toEqual([2]);
  });

  it('유한하지 않은 정확도는 건너뛴다', () => {
    const m = bestAccuracyByChart([log({ chart: 1, accuracy: Number.NaN }), log({ chart: 1, accuracy: 0.2 })], 'RHYTHM');
    expect(m.get(1)).toBe(0.2);
  });
});
