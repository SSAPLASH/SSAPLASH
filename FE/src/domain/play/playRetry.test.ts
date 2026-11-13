// 다시 하기 경로 테스트
import { describe, expect, it } from 'vitest';
import { BUILTIN_CHARTS } from '@/domain/song/chart';
import { RETRY_AUTOSTART_STATE, retryPathOf } from './playRetry';

const builtinSongId = BUILTIN_CHARTS[1].songId;

describe('retryPathOf', () => {
  it('BE id가 있으면 소스와 무관하게 그 id로 간다', () => {
    const log = { mode: 'RHYTHM', songNumericId: 7, chartId: 9, songId: 'x' };
    expect(retryPathOf(log, { songsSource: 'api' })).toBe('/play?song=7&chart=9');
    expect(retryPathOf(log, { songsSource: 'builtin' })).toBe('/play?song=7&chart=9');
  });
  it('내장 소스에서 songId가 내장 채보와 맞으면 음수 id로 복원한다', () => {
    const log = { mode: 'RHYTHM', songNumericId: null, chartId: null, songId: builtinSongId };
    expect(retryPathOf(log, { songsSource: 'builtin' })).toBe('/play?song=-2&chart=-2');
  });
  it('내장 소스여도 songId가 맞지 않으면 선택 화면', () => {
    const log = { mode: 'RHYTHM', songNumericId: null, chartId: null, songId: 'unknown' };
    expect(retryPathOf(log, { songsSource: 'builtin' })).toBe('/play');
  });
  it('api 소스에서 id가 없으면 선택 화면', () => {
    const log = { mode: 'RHYTHM', songNumericId: null, chartId: null, songId: builtinSongId };
    expect(retryPathOf(log, { songsSource: 'api' })).toBe('/play');
  });
  it('SHEET 모드는 /sheet 경로를 쓴다', () => {
    expect(retryPathOf({ mode: 'SHEET', songNumericId: 3, chartId: 4, songId: 'x' }, { songsSource: 'api' })).toBe('/sheet?song=3&chart=4&start=1');
    const log = { mode: 'SHEET', songNumericId: null, chartId: null, songId: builtinSongId };
    expect(retryPathOf(log, { songsSource: 'builtin' })).toBe('/sheet?song=-2&chart=-2&start=1');
    expect(retryPathOf({ ...log, songId: 'zz' }, { songsSource: 'builtin' })).toBe('/sheet');
  });

  it('리듬 게임 다시 하기는 주소가 아니라 navigate state로 바로 시작을 알린다', () => {
    expect(RETRY_AUTOSTART_STATE).toEqual({ autoStart: true });
    expect(retryPathOf({ mode: 'RHYTHM', songNumericId: 7, chartId: 9, songId: 'x' }, { songsSource: 'api' })).not.toContain('start');
  });
});
