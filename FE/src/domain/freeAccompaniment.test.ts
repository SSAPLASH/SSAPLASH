// 자유 연습 반주 화면 상태 계산 (설계 MODE-002 3-4~3-6) 표 케이스.
import { describe, expect, it } from 'vitest';
import {
  accompanimentBarView,
  formatClock,
  formatSpoken,
  pickableForAccompaniment,
  seekTarget,
  type AccompanimentBarInput,
  type AccompanimentPick,
} from './freeAccompaniment';

const pick: AccompanimentPick = { songId: 1, title: '곡', artist: '가수', coverUrl: null };

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [72_000, '1:12'],
    [204_500, '3:24'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_723_000, '1:02:03'],
    [-5, '0:00'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});

describe('formatSpoken', () => {
  it('분·초를 말로 쓴다', () => {
    expect(formatSpoken(72_000)).toBe('1분 12초');
    expect(formatSpoken(5_000)).toBe('5초');
    expect(formatSpoken(3_723_000)).toBe('1시간 2분 3초');
  });
});

describe('seekTarget', () => {
  it.each([
    [-100, 200_000, 0],
    [0, 200_000, 0],
    [50_000, 200_000, 50_000],
    [199_900, 200_000, 199_750],
    [999_999, 200_000, 199_750],
    [Number.NaN, 200_000, 0],
    [5000, 0, 0],
    [5000, 100, 0],
  ])('요청 %d · 길이 %d → %d', (req, dur, want) => {
    expect(seekTarget(req, dur)).toBe(want);
  });
});

describe('pickableForAccompaniment', () => {
  it.each([
    ['READY', 'READY', 'ready'],
    ['READY', 'GENERATING', 'generating'],
    ['READY', 'FAILED', 'hidden'],
    ['READY', 'NONE', 'hidden'],
    ['PENDING', 'READY', 'hidden'],
    ['FAILED', 'GENERATING', 'hidden'],
  ] as const)('곡 %s · 반주 %s → %s', (status, acc, want) => {
    expect(pickableForAccompaniment({ status, accompanimentStatus: acc })).toBe(want);
  });
});

describe('accompanimentBarView (3-5)', () => {
  const base: AccompanimentBarInput = { pick, playerState: 'idle', positionMs: 0, durationMs: 0, errorText: null };
  const view = (p: Partial<AccompanimentBarInput>) => accompanimentBarView({ ...base, ...p });

  it('고른 곡이 없으면 none(재생기 상태 무관)', () => {
    const v = view({ pick: null, playerState: 'playing', positionMs: 5000 });
    expect(v.phase).toBe('none');
    expect(v.pick).toBeNull();
    expect(v.seekable).toBe(false);
  });

  it('URL 조회 중·loading·idle은 loading', () => {
    expect(view({ loading: true }).phase).toBe('loading');
    expect(view({ playerState: 'loading' }).phase).toBe('loading');
    expect(view({ playerState: 'idle' }).phase).toBe('loading');
    expect(view({ playerState: 'loading' }).seekable).toBe(false);
  });

  it('playing: 위치·시간 글자·seekable', () => {
    const v = view({ playerState: 'playing', positionMs: 72_000, durationMs: 204_000 });
    expect(v).toMatchObject({ phase: 'playing', positionMs: 72_000, timeText: '1:12 / 3:24', seekable: true, errorText: null });
    expect(v.pick).toBe(pick);
  });

  it('paused: 훅이 든 위치를 쓴다', () => {
    const v = view({ playerState: 'paused', positionMs: 30_000, durationMs: 100_000 });
    expect(v).toMatchObject({ phase: 'paused', positionMs: 30_000, timeText: '0:30 / 1:40', seekable: true });
  });

  it('ready(곡 끝)는 위치 0의 paused', () => {
    const v = view({ playerState: 'ready', positionMs: 99_999, durationMs: 100_000 });
    expect(v).toMatchObject({ phase: 'paused', positionMs: 0, seekable: true });
  });

  it('오류 문구가 있거나 재생기가 error면 error', () => {
    const v = view({ playerState: 'idle', errorText: '이 곡은 반주 파일이 없어요' });
    expect(v).toMatchObject({ phase: 'error', errorText: '이 곡은 반주 파일이 없어요', seekable: false });
    expect(view({ playerState: 'error' }).phase).toBe('error');
    expect(view({ playerState: 'error' }).errorText).toBe('반주를 불러오지 못했어요');
  });

  it('오류가 loading보다 우선한다', () => {
    expect(view({ loading: true, errorText: 'x' }).phase).toBe('error');
  });
});
