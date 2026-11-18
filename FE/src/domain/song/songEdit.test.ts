import { describe, expect, it } from 'vitest';
import { MAX_NAME_LEN, SONG_EDIT_UNCERTAIN_TEXT, diffMeta, isSongEditUncertain, menuKinds, songEditFailure, songEditErrorText, validateMeta } from './songEdit';

describe('validateMeta', () => {
  it('제목 1~100자(trim 후), 아티스트 0~100자', () => {
    expect(validateMeta({ title: '곡', artist: '' })).toEqual({ ok: true });
    expect(validateMeta({ title: 'a'.repeat(MAX_NAME_LEN), artist: 'b'.repeat(MAX_NAME_LEN) })).toEqual({ ok: true });
  });

  it('제목이 비었거나 공백뿐이면 거부', () => {
    expect(validateMeta({ title: '   ', artist: '' })).toEqual({ ok: false, reason: 'TITLE_EMPTY' });
  });

  it('길이 초과 거부, 공백은 세지 않는다', () => {
    expect(validateMeta({ title: 'a'.repeat(MAX_NAME_LEN + 1), artist: '' })).toEqual({ ok: false, reason: 'TITLE_LONG' });
    expect(validateMeta({ title: ` ${'a'.repeat(MAX_NAME_LEN)} `, artist: '' })).toEqual({ ok: true });
    expect(validateMeta({ title: '곡', artist: 'b'.repeat(MAX_NAME_LEN + 1) })).toEqual({ ok: false, reason: 'ARTIST_LONG' });
  });
});

describe('diffMeta', () => {
  const current = { title: '곡', artist: '가수' };

  it('바뀐 필드만 담는다(trim한 값)', () => {
    expect(diffMeta(current, { title: ' 새 곡 ', artist: '가수' })).toEqual({ title: '새 곡' });
    expect(diffMeta(current, { title: '곡', artist: '다른 가수' })).toEqual({ artist: '다른 가수' });
    expect(diffMeta(current, { title: '새 곡', artist: '다른 가수' })).toEqual({ title: '새 곡', artist: '다른 가수' });
  });

  it('바뀐 게 없으면 빈 객체(공백만 다른 것도 같은 값)', () => {
    expect(diffMeta(current, { title: ' 곡 ', artist: '가수 ' })).toEqual({});
  });

  it('아티스트를 비우면 빈 문자열', () => {
    expect(diffMeta(current, { title: '곡', artist: '  ' })).toEqual({ artist: '' });
  });
});

describe('오류 문구', () => {
  it.each([
    ['SONG_INVALID', '제목(1~100자)과 아티스트(100자 이하)를 확인해 주세요.'],
    ['SONG_FORBIDDEN', '내 곡만 수정할 수 있습니다.'],
    ['SONG_NOT_FOUND', '이미 없는 곡입니다. 목록을 새로 고칩니다.'],
    ['SONG_BUSY', '채보를 만드는 중인 곡은 바꿀 수 없습니다.'],
    ['COVER_INVALID', 'JPG·PNG·WebP 이미지만 쓸 수 있습니다.'],
    ['COVER_UNSUPPORTED', 'JPG·PNG·WebP 이미지만 쓸 수 있습니다.'],
    ['COVER_TOO_LARGE', '이미지가 너무 큽니다.'],
    ['COVER_UNAVAILABLE', '지금은 커버를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.'],
  ])('%s → 문구, 결과를 아는 실패', (code, text) => {
    expect(songEditErrorText(code)).toBe(text);
    expect(isSongEditUncertain(code)).toBe(false);
  });

  it('알 수 없는 코드·네트워크는 확인하지 못했다는 문구와 uncertain', () => {
    for (const code of ['NETWORK', 'HTTP_ERROR', 'WHATEVER']) {
      expect(songEditErrorText(code)).toBe(SONG_EDIT_UNCERTAIN_TEXT);
      expect(isSongEditUncertain(code)).toBe(true);
    }
  });
});

describe('menuKinds', () => {
  it('완료 곡은 커버 변경·곡 정보 수정·곡 삭제', () => {
    expect(menuKinds('READY')).toEqual(['cover', 'meta', 'delete']);
  });

  it('실패 곡은 곡 삭제만', () => {
    expect(menuKinds('FAILED')).toEqual(['delete']);
  });

  it('처리 중·알 수 없는 상태는 메뉴 없음', () => {
    expect(menuKinds('PROCESSING')).toEqual([]);
    expect(menuKinds('')).toEqual([]);
  });
});

describe('songEditFailure', () => {
  it('4xx는 코드 문구, 결과를 아는 실패', () => {
    expect(songEditFailure(409, 'SONG_BUSY')).toEqual({ text: '채보를 만드는 중인 곡은 바꿀 수 없습니다.', uncertain: false });
  });

  it('5xx는 코드가 있어도 결과를 모른다. 단 503 COVER_UNAVAILABLE은 저장 전 실패', () => {
    expect(songEditFailure(500, 'SONG_INVALID')).toEqual({ text: SONG_EDIT_UNCERTAIN_TEXT, uncertain: true });
    expect(songEditFailure(503, 'COVER_UNAVAILABLE')).toEqual({ text: '지금은 커버를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.', uncertain: false });
  });

  it('네트워크(status 0)는 결과를 모른다', () => {
    expect(songEditFailure(0, 'NETWORK')).toEqual({ text: SONG_EDIT_UNCERTAIN_TEXT, uncertain: true });
  });
});

describe('menuKinds 악보 항목', () => {
  it('연결된 악보가 있으면 [악보 보기], 없으면 [악보 올리기]를 맨 앞에 넣는다(Figma 순서)', () => {
    expect(menuKinds('READY', { sheetId: 5 })).toEqual(['sheetView', 'cover', 'meta', 'delete']);
    expect(menuKinds('READY', { sheetId: null })).toEqual(['sheetUpload', 'cover', 'meta', 'delete']);
  });

  it('실패·처리 중 곡에는 악보 항목이 없다', () => {
    expect(menuKinds('FAILED', { sheetId: null })).toEqual(['delete']);
    expect(menuKinds('PROCESSING', { sheetId: null })).toEqual([]);
  });
});
