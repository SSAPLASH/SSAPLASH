import { describe, expect, it } from 'vitest';
import { defaultRecordingTitle, type RecordingHit, type RecordingMode } from './recording';
import {
  formatHitCount,
  pendingDurationMs,
  RECORDING_QUOTA,
  recordingCountLabel,
  recordingModeName,
  recordingRowLabel,
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

describe('recordingRowLabel', () => {
  const at = new Date(2026, 10, 12, 14, 23);
  const song = { songId: 7, title: '별빛 산책', difficulty: 'HARD' };
  const item = (over: { title: string; mode?: RecordingMode; song?: typeof song | null }) => ({
    mode: 'SHEET' as RecordingMode,
    startedAt: at.toISOString(),
    song,
    ...over,
  });

  it('직접 지은 제목은 그대로, 곡과 모드도 보조 정보에 둔다', () => {
    expect(recordingRowLabel(item({ title: '킥 연습 첫 녹음' }))).toEqual({ title: '킥 연습 첫 녹음', songInTitle: false, showMode: true });
  });

  it('기본 제목 그대로면 곡 제목만 남기고, 곡은 보조 정보에서 뺀다', () => {
    expect(recordingRowLabel(item({ title: defaultRecordingTitle('별빛 산책', at) }))).toEqual({ title: '별빛 산책', songInTitle: true, showMode: true });
  });

  it('자유 연습의 기본 제목이면 "자유 연습"만 남기고 모드를 다시 적지 않는다', () => {
    expect(recordingRowLabel(item({ title: defaultRecordingTitle(null, at), mode: 'FREE', song: null }))).toEqual({
      title: '자유 연습',
      songInTitle: false,
      showMode: false,
    });
  });

  it('곡이 지워진 녹음의 기본 제목은 시각만 떼고 이름을 남긴다', () => {
    expect(recordingRowLabel(item({ title: defaultRecordingTitle('옛 곡', at), song: null }))).toEqual({ title: '옛 곡', songInTitle: false, showMode: true });
  });

  it('곡 제목이 길어 줄여 붙인 기본 제목이면 곡 제목 전체를 보인다', () => {
    const long = '가'.repeat(120);
    const label = recordingRowLabel(item({ title: defaultRecordingTitle(long, at), song: { ...song, title: long } }));
    expect(label).toEqual({ title: long, songInTitle: true, showMode: true });
  });

  it('다른 시각이 붙은 제목·시각만 있는 제목·깨진 시각은 건드리지 않는다', () => {
    const other = defaultRecordingTitle('별빛 산책', new Date(2026, 10, 12, 14, 24));
    expect(recordingRowLabel(item({ title: other })).title).toBe(other);
    const bare = defaultRecordingTitle('', at).replace('자유 연습', '');
    expect(recordingRowLabel(item({ title: bare })).title).toBe(bare);
    expect(recordingRowLabel({ ...item({ title: '내 연주' }), startedAt: 'x' })).toEqual({ title: '내 연주', songInTitle: false, showMode: true });
  });
});
