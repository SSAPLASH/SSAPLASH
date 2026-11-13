import { describe, expect, it } from 'vitest';
import type { BestRecordDto } from '@/api/play/plays';
import { selectServerBestRecords } from './serverBestRecord';

const row = (over: Partial<BestRecordDto> = {}): BestRecordDto => ({ songId: 1, chartId: 11, difficulty: 'EASY', mode: 'RHYTHM', bestScore: 100, bestAccuracy: 98.76, ...over });

describe('서버 최고 기록 선택', () => {
  it('모드·곡을 분리하고 곡 최댓값과 단계별 정확도를 독립적으로 선택한다', () => {
    const rows = [row(), row({ chartId: 12, difficulty: 'HARD', bestScore: 200, bestAccuracy: 80 }), row({ mode: 'SHEET', bestScore: 900, bestAccuracy: 50 }), row({ songId: 2, bestScore: 9999 })];
    const result = selectServerBestRecords(rows, [1], 'RHYTHM');
    expect([...result.scoresBySong]).toEqual([[1, 200]]);
    expect(result.accuraciesBySong.get(1)).toBeCloseTo(0.9876);
    expect(result.accuraciesByChart.get(11)).toBeCloseTo(0.9876);
    expect(result.accuraciesByChart.get(12)).toBe(0.8);
    expect(result.scoresByChart.get(11)).toBe(100);
    expect(result.scoresByChart.get(12)).toBe(200);
    expect(result.scoresByChart.size).toBe(2);
    expect(selectServerBestRecords(rows, [1], 'SHEET').accuraciesBySong.get(1)).toBe(0.5);
  });
  it('0을 유지하고 null·잘못된 수치·ID·누락은 기록 없음으로 처리한다', () => {
    const result = selectServerBestRecords([
      row({ bestScore: 0, bestAccuracy: 0 }),
      row({ songId: 2, chartId: 22, bestScore: null, bestAccuracy: null }),
      row({ songId: 3, chartId: 33, bestScore: NaN, bestAccuracy: 101 }),
      row({ chartId: -1, bestScore: 9000 }),
      row({ bestScore: -1, bestAccuracy: -1 }),
    ], [1, 2, 3, 4], 'RHYTHM');
    expect([...result.scoresBySong]).toEqual([[1, 0]]);
    expect([...result.accuraciesByChart]).toEqual([[11, 0]]);
    expect([...result.scoresByChart]).toEqual([[11, 0]]);
    expect(result.accuraciesBySong.has(2)).toBe(false);
    expect(result.accuraciesBySong.has(4)).toBe(false);
  });
});
