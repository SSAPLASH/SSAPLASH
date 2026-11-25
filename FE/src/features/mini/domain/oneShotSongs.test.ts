import { describe, expect, it } from 'vitest';
import { CLIP_TOLERANCE_MS, clipMatches, isOneShotSongId, ONE_SHOT_SONGS, ONE_SHOT_VARIANTS, songById, songUrl } from './oneShotSongs';

describe('ONE_SHOT_SONGS', () => {
  it('곡이 한 곡 이상 있고 첫 곡은 iwaly다', () => {
    expect(ONE_SHOT_SONGS.length).toBeGreaterThanOrEqual(1);
    const first = ONE_SHOT_SONGS[0];
    expect(first.id).toBe('iwaly');
    expect(first.name).toBe('I Will Always Love You');
    expect(first.artist).toBe('Whitney Houston');
    expect(first.file).toBe('iwaly.wav');
  });

  it('곡 id는 서로 다르다', () => {
    const ids = ONE_SHOT_SONGS.map((song) => song.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ONE_SHOT_SONGS.map((song) => [song.id, song] as const))('%s: 위치 순서와 파일 확장자가 맞다', (_id, song) => {
    expect(song.restStartMs).toBeGreaterThan(0);
    expect(song.restStartMs).toBeLessThan(song.answerMs);
    expect(song.answerMs).toBeLessThan(song.durationMs);
    expect(song.tailMs).toBeGreaterThan(0);
    expect(/\.(wav|flac)$/.test(song.file)).toBe(true);
  });
});

describe('ONE_SHOT_VARIANTS', () => {
  it('곡 표의 id와 이름을 표 순서대로 담는다', () => {
    expect(ONE_SHOT_VARIANTS).toEqual(ONE_SHOT_SONGS.map(({ id, name }) => ({ id, name })));
  });
});

describe('isOneShotSongId', () => {
  it('곡 표에 있는 id만 참', () => {
    expect(isOneShotSongId('iwaly')).toBe(true);
    expect(isOneShotSongId('nope')).toBe(false);
    expect(isOneShotSongId('')).toBe(false);
    expect(isOneShotSongId(null)).toBe(false);
    expect(isOneShotSongId(3)).toBe(false);
  });
});

describe('songById', () => {
  it('아는 id면 그 곡', () => {
    expect(songById('iwaly')).toBe(ONE_SHOT_SONGS[0]);
  });

  it('모르는 id·null·undefined면 첫 곡', () => {
    expect(songById('nope')).toBe(ONE_SHOT_SONGS[0]);
    expect(songById(null)).toBe(ONE_SHOT_SONGS[0]);
    expect(songById(undefined)).toBe(ONE_SHOT_SONGS[0]);
  });
});

describe('songUrl', () => {
  const song = ONE_SHOT_SONGS[0];

  it('폴더 주소에 파일 이름을 붙인다', () => {
    expect(songUrl('/event-audio', song)).toBe('/event-audio/iwaly.wav');
  });

  it('끝의 슬래시는 하나든 여럿이든 정리한다', () => {
    expect(songUrl('/event-audio/', song)).toBe('/event-audio/iwaly.wav');
    expect(songUrl('/event-audio///', song)).toBe('/event-audio/iwaly.wav');
  });

  it('절대 주소도 된다', () => {
    expect(songUrl('https://x.test/a/', song)).toBe('https://x.test/a/iwaly.wav');
  });
});

describe('clipMatches', () => {
  const song = ONE_SHOT_SONGS[0];
  const d = song.durationMs;

  it('허용 오차는 50ms', () => {
    expect(CLIP_TOLERANCE_MS).toBe(50);
  });

  it('같거나 ±50ms 이내면 참', () => {
    expect(clipMatches(song, d)).toBe(true);
    expect(clipMatches(song, d + 50)).toBe(true);
    expect(clipMatches(song, d - 50)).toBe(true);
  });

  it('±51ms부터는 거짓', () => {
    expect(clipMatches(song, d + 51)).toBe(false);
    expect(clipMatches(song, d - 51)).toBe(false);
  });

  it('NaN·Infinity는 거짓', () => {
    expect(clipMatches(song, NaN)).toBe(false);
    expect(clipMatches(song, Infinity)).toBe(false);
    expect(clipMatches(song, -Infinity)).toBe(false);
  });
});
