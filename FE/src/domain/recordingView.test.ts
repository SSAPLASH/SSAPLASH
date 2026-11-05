import { describe, expect, it } from 'vitest';
import type { RecordingHit, RecordingMode } from './recording';
import {
  formatElapsed,
  formatHitCount,
  formatRecordingLength,
  pendingDurationMs,
  RECORDING_QUOTA,
  recordingCountLabel,
  recordingModeName,
  recordingSummaryLine,
  songDifficulty,
} from './recordingView';

const hit = (tMs: number): RecordingHit => ({ tMs, pad: 'SNARE', velocity: 100 });

describe('recordingModeName', () => {
  it('모드별 이름, 그 밖은 값 그대로', () => {
    expect(recordingModeName('FREE')).toBe('자유 연습');
    expect(recordingModeName('RHYTHM')).toBe('리듬 게임');
    expect(recordingModeName('SHEET')).toBe('악보 연습');
    expect(recordingModeName('TEMPO')).toBe('TEMPO');
    expect(recordingModeName('X' as RecordingMode)).toBe('X');
  });
});

describe('formatHitCount', () => {
  it('천 단위 콤마와 "타"', () => {
    expect(formatHitCount(0)).toBe('0타');
    expect(formatHitCount(999)).toBe('999타');
    expect(formatHitCount(1000)).toBe('1,000타');
    expect(formatHitCount(1904)).toBe('1,904타');
    expect(formatHitCount(50000)).toBe('50,000타');
  });
});

describe('formatElapsed', () => {
  it('mm:ss 내림, 음수는 0', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(-500)).toBe('00:00');
    expect(formatElapsed(999)).toBe('00:00');
    expect(formatElapsed(59_999)).toBe('00:59');
    expect(formatElapsed(60_000)).toBe('01:00');
    expect(formatElapsed(83_000)).toBe('01:23');
  });

  it('100분 이상이면 자리수가 늘어난다', () => {
    expect(formatElapsed((123 * 60 + 45) * 1000)).toBe('123:45');
  });
});

describe('formatRecordingLength', () => {
  it('m:ss 반올림', () => {
    expect(formatRecordingLength(0)).toBe('0:00');
    expect(formatRecordingLength(499)).toBe('0:00');
    expect(formatRecordingLength(500)).toBe('0:01');
    expect(formatRecordingLength(59_400)).toBe('0:59');
    expect(formatRecordingLength(59_500)).toBe('1:00');
    expect(formatRecordingLength(60_000)).toBe('1:00');
    expect(formatRecordingLength(135_000)).toBe('2:15');
  });
});

describe('recordingSummaryLine', () => {
  it('곡 제목이 있으면 네 칸', () => {
    expect(
      recordingSummaryLine({ mode: 'RHYTHM', songTitle: '봄날', durationMs: 135_000, hitCount: 1904 }),
    ).toBe('리듬 게임 · 봄날 · 2:15 · 타격 1,904개');
  });

  it('곡 제목이 null이면 그 칸을 뺀다', () => {
    expect(recordingSummaryLine({ mode: 'FREE', songTitle: null, durationMs: 135_000, hitCount: 286 })).toBe(
      '자유 연습 · 2:15 · 타격 286개',
    );
  });

  it('길이 0·타격 0', () => {
    expect(recordingSummaryLine({ mode: 'SHEET', songTitle: null, durationMs: 0, hitCount: 0 })).toBe(
      '악보 연습 · 0:00 · 타격 0개',
    );
  });
});

describe('pendingDurationMs', () => {
  it('hits가 비면 기본 길이', () => {
    expect(pendingDurationMs(120_000, [])).toBe(120_000);
  });

  it('마지막 tMs가 더 크면 그 값을 올림', () => {
    expect(pendingDurationMs(1000, [hit(10), hit(2500.2)])).toBe(2501);
  });

  it('기본 길이가 더 크면 기본 길이(정수 올림)', () => {
    expect(pendingDurationMs(5000, [hit(10), hit(4999.5)])).toBe(5000);
    expect(pendingDurationMs(5000.4, [hit(10)])).toBe(5001);
  });
});

describe('songDifficulty', () => {
  it('EASY·NORMAL·HARD만 통과', () => {
    expect(songDifficulty('EASY')).toBe('EASY');
    expect(songDifficulty('NORMAL')).toBe('NORMAL');
    expect(songDifficulty('HARD')).toBe('HARD');
  });

  it('알 수 없는 값·빈 값은 null', () => {
    expect(songDifficulty('EXPERT')).toBeNull();
    expect(songDifficulty('easy')).toBeNull();
    expect(songDifficulty('')).toBeNull();
    expect(songDifficulty(null)).toBeNull();
    expect(songDifficulty(undefined)).toBeNull();
  });
});

describe('recordingCountLabel', () => {
  it('개수와 최대 200개', () => {
    expect(RECORDING_QUOTA).toBe(200);
    expect(recordingCountLabel(0)).toBe('녹음 0개 · 최대 200개');
    expect(recordingCountLabel(37)).toBe('녹음 37개 · 최대 200개');
  });
});
