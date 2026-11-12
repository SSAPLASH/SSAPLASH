// 반주 오류 문구 변환 (설계 MODE-002 3-6) 표 케이스.
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/error';
import { accompanimentErrorText } from './accompanimentError';

describe('accompanimentErrorText', () => {
  const api = (status: number, code: string) => new ApiError(status, code, 'x');
  it('3-6 표대로 바꾼다', () => {
    expect(accompanimentErrorText(api(404, 'CHART_ASSET_NOT_FOUND'))).toBe('이 곡은 반주 파일이 없어요');
    expect(accompanimentErrorText(api(404, 'SONG_NOT_FOUND'))).toBe('곡을 찾을 수 없어요. 삭제됐을 수 있어요');
    expect(accompanimentErrorText(api(409, 'SONG_NOT_READY'))).toBe('곡이 아직 준비 중이에요');
    expect(accompanimentErrorText(api(503, 'X'))).toBe('반주를 불러오지 못했어요');
    expect(accompanimentErrorText(api(0, 'NETWORK'))).toBe('반주를 불러오지 못했어요');
    expect(accompanimentErrorText(new Error('decode'))).toBe('반주를 불러오지 못했어요');
  });
});
