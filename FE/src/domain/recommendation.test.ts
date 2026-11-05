import { describe, expect, it } from 'vitest';
import { cardOf, matchedOnText, MATCHED_ON_COPY, primaryReason, similarCardOf, similarFromDto, recommendationPathOf, REASON_COPY, reasonText, recommendationFromDto } from './recommendation';

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

describe('recommendationPathOf', () => {
  const card = { song: { id: 7 }, chartId: 9 };
  it('RHYTHM은 /play, SHEET는 /sheet', () => {
    expect(recommendationPathOf(card, 'RHYTHM')).toBe('/play?song=7&chart=9');
    expect(recommendationPathOf(card, 'SHEET')).toBe('/sheet?song=7&chart=9');
  });
  it('FREE·빈 값은 /play', () => {
    expect(recommendationPathOf(card, 'FREE')).toBe('/play?song=7&chart=9');
    expect(recommendationPathOf(card, '')).toBe('/play?song=7&chart=9');
  });
});

describe('matchedOnText', () => {
  it.each(Object.entries(MATCHED_ON_COPY))('%s는 FE 문구를 쓴다', (code, copy) => {
    expect(matchedOnText([code])).toBe(copy);
  });
  it('첫 코드만 쓴다', () => {
    expect(matchedOnText(['PADS', 'RHYTHM'])).toBe(MATCHED_ON_COPY.PADS);
  });
  it('모르는 코드·프로토타입 키·빈 배열은 빈 문자열이고 다음 코드를 보지 않는다', () => {
    expect(matchedOnText(['GENRE', 'RHYTHM'])).toBe('');
    expect(matchedOnText(['toString'])).toBe('');
    expect(matchedOnText([])).toBe('');
  });
});

describe('similarFromDto', () => {
  it('필드를 변환하고 similarity는 보관한다', () => {
    const it = similarFromDto({ song: songDto, chartId: 5, difficulty: 'HARD', similarity: 0.83, matchedOn: ['TEMPO', 'DENSITY'] });
    expect(it).toMatchObject({ chartId: 5, difficulty: 'HARD', similarity: 0.83, matchedOn: ['TEMPO', 'DENSITY'] });
    expect(it.song.id).toBe(12);
  });
  it('matchedOn이 배열이 아니면 빈 배열', () => {
    expect(similarFromDto({ song: songDto, chartId: 5, difficulty: 'EASY', similarity: 1, matchedOn: 'RHYTHM' }).matchedOn).toEqual([]);
  });
  it('모르는 난이도는 NORMAL, similarity가 숫자가 아니면 0', () => {
    const it = similarFromDto({ song: songDto, chartId: 5, difficulty: 'X', similarity: 'a' });
    expect(it.difficulty).toBe('NORMAL');
    expect(it.similarity).toBe(0);
  });
});

describe('카드 변환', () => {
  const song = recommendationFromDto({ song: songDto, chartId: 1, difficulty: 'EASY', reasons: [] }).song;
  it('cardOf는 첫 이유 문구를 line으로 쓴다', () => {
    expect(cardOf({ song, chartId: 1, difficulty: 'EASY', reasons: [{ code: 'STARTER', text: 'a' }] }).line).toBe(REASON_COPY.STARTER);
  });
  it('similarCardOf는 matchedOnText를 line으로 쓴다', () => {
    const c = similarCardOf({ song, chartId: 2, difficulty: 'HARD', similarity: 0.5, matchedOn: ['RHYTHM'] });
    expect(c).toEqual({ song, chartId: 2, difficulty: 'HARD', line: MATCHED_ON_COPY.RHYTHM });
  });
});
