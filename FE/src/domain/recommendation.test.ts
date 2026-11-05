import { describe, expect, it } from 'vitest';
import { primaryReason, REASON_COPY, reasonText, recommendationFromDto } from './recommendation';

const songDto = {
  id: 12, title: '곡', artist: '가수', source: 'BUILTIN', status: 'READY', bpm: 120, timeSignature: '3/4', durationMs: 90000,
  hasAccompaniment: true, accompanimentStatus: 'READY', songLevel: 'BEGINNER', difficulties: ['HARD', 'EASY'],
  createdAt: '2026-11-01T00:00:00Z', coverUrl: 'https://x/c.jpg',
};

describe('reasonText', () => {
  it.each(Object.entries(REASON_COPY))('%s는 FE 문구를 쓴다', (code, copy) => {
    expect(reasonText({ code, text: 'BE 문구' })).toBe(copy);
  });

  it('모르는 코드는 BE text 그대로', () => {
    expect(reasonText({ code: 'NEW_CODE', text: 'BE 문구' })).toBe('BE 문구');
  });

  it('Object 프로토타입 키도 모르는 코드로 본다', () => {
    expect(reasonText({ code: 'toString', text: 'BE 문구' })).toBe('BE 문구');
  });
});

describe('primaryReason', () => {
  it('첫 이유만 쓴다', () => {
    const reasons = [{ code: 'STARTER', text: 'a' }, { code: 'RETRY', text: 'b' }];
    expect(primaryReason({ reasons })).toBe(REASON_COPY.STARTER);
  });

  it('이유가 비면 빈 문자열', () => {
    expect(primaryReason({ reasons: [] })).toBe('');
  });
});

describe('recommendationFromDto', () => {
  it('song 전체 필드를 SongSummary로 바꾼다', () => {
    const item = recommendationFromDto({ song: songDto, chartId: 34, difficulty: 'EASY', reasons: [{ code: 'STARTER', text: 't' }] });
    expect(item.chartId).toBe(34);
    expect(item.difficulty).toBe('EASY');
    expect(item.reasons).toEqual([{ code: 'STARTER', text: 't' }]);
    expect(item.song).toMatchObject({
      id: 12, bpm: 120, timeSignature: '3/4', status: 'READY', songLevel: 'BEGINNER', difficulties: ['EASY', 'HARD'], coverUrl: 'https://x/c.jpg',
    });
  });

  it('song에 없는 필드는 기존 기본값 규칙을 따른다', () => {
    const item = recommendationFromDto({ song: { id: 1, title: 't', artist: 'a' }, chartId: 2, difficulty: 'NORMAL', reasons: [] });
    expect(item.song.bpm).toBe(0);
    expect(item.song.timeSignature).toBe('4/4');
    expect(item.song.coverUrl).toBeNull();
  });

  it('chartId가 정수가 아니면 던진다', () => {
    expect(() => recommendationFromDto({ song: songDto, chartId: 1.5, difficulty: 'EASY', reasons: [] })).toThrow();
    expect(() => recommendationFromDto({ song: songDto, chartId: 'x', difficulty: 'EASY', reasons: [] })).toThrow();
  });

  it('reasons가 없으면 빈 배열', () => {
    expect(recommendationFromDto({ song: songDto, chartId: 1, difficulty: 'EASY' }).reasons).toEqual([]);
  });
});
