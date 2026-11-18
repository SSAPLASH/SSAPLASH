import { describe, expect, it } from 'vitest';
import { availabilityFromFailure, songIdsToCheck } from './songAvailability';

describe('availabilityFromFailure', () => {
  it('404 SONG_NOT_FOUND만 삭제된 곡이다', () => {
    expect(availabilityFromFailure({ status: 404, code: 'SONG_NOT_FOUND' })).toBe('deleted');
  });

  it('다른 404·5xx·401·네트워크·알 수 없는 실패는 모름(삭제로 단정하지 않음)', () => {
    expect(availabilityFromFailure({ status: 404, code: 'NOT_FOUND' })).toBe('unknown');
    expect(availabilityFromFailure({ status: 500, code: 'SONG_NOT_FOUND' })).toBe('unknown');
    expect(availabilityFromFailure({ status: 401, code: 'UNAUTHORIZED' })).toBe('unknown');
    expect(availabilityFromFailure({ status: 0, code: 'NETWORK' })).toBe('unknown');
    expect(availabilityFromFailure(null)).toBe('unknown');
  });
});

describe('songIdsToCheck', () => {
  it('BE 곡 id만 한 번씩, 처음 나온 순서로', () => {
    expect(songIdsToCheck([{ songNumericId: 4 }, { songNumericId: 9 }, { songNumericId: 4 }])).toEqual([4, 9]);
  });

  it('내장 채보 로그(id 없음·null)와 잘못된 id는 건너뛴다', () => {
    expect(songIdsToCheck([{}, { songNumericId: null }, { songNumericId: 0 }, { songNumericId: -3 }, { songNumericId: 1.5 }])).toEqual([]);
  });
});
