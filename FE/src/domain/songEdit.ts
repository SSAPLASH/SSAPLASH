// 곡 표시명 편집 도메인 (설계 CHART-001 3·4-2). 검증·바뀐 필드 계산·오류 코드 → 문구. 요청·상태는 다루지 않는다.

/** 제목·아티스트 최대 길이 */
export const MAX_NAME_LEN = 100;

/** 보낸 필드만 바꾼다. 아티스트 `""`는 비움 */
export interface SongMetaPatch {
  title?: string;
  artist?: string;
}

export interface SongMetaInput {
  title: string;
  artist: string;
}

export type MetaCheckReason = 'TITLE_EMPTY' | 'TITLE_LONG' | 'ARTIST_LONG';
export type MetaCheck = { ok: true } | { ok: false; reason: MetaCheckReason };

export const META_CHECK_TEXT: Record<MetaCheckReason, string> = {
  TITLE_EMPTY: '제목을 입력해 주세요.',
  TITLE_LONG: `제목은 ${MAX_NAME_LEN}자 이하로 입력해 주세요.`,
  ARTIST_LONG: `아티스트는 ${MAX_NAME_LEN}자 이하로 입력해 주세요.`,
};

/** 제목 1~100자(trim 후), 아티스트 0~100자(trim 후) */
export function validateMeta(input: SongMetaInput): MetaCheck {
  const title = input.title.trim();
  if (title.length === 0) return { ok: false, reason: 'TITLE_EMPTY' };
  if (title.length > MAX_NAME_LEN) return { ok: false, reason: 'TITLE_LONG' };
  if (input.artist.trim().length > MAX_NAME_LEN) return { ok: false, reason: 'ARTIST_LONG' };
  return { ok: true };
}

/** 현재 값과 비교해 바뀐 필드만(trim한 값). 바뀐 게 없으면 빈 객체 */
export function diffMeta(current: SongMetaInput, next: SongMetaInput): SongMetaPatch {
  const patch: SongMetaPatch = {};
  const title = next.title.trim();
  const artist = next.artist.trim();
  if (title !== current.title.trim()) patch.title = title;
  if (artist !== current.artist.trim()) patch.artist = artist;
  return patch;
}

export const SONG_EDIT_UNCERTAIN_TEXT = '결과를 확인하지 못했습니다. 목록을 확인해 주세요.';

const SONG_EDIT_ERROR_TEXT: Record<string, string> = {
  SONG_INVALID: '제목(1~100자)과 아티스트(100자 이하)를 확인해 주세요.',
  SONG_FORBIDDEN: '내 곡만 수정할 수 있습니다.',
  SONG_NOT_FOUND: '이미 없는 곡입니다. 목록을 새로 고칩니다.',
  SONG_BUSY: '채보를 만드는 중인 곡은 바꿀 수 없습니다.',
  COVER_INVALID: 'JPG·PNG·WebP 이미지만 쓸 수 있습니다.',
  COVER_UNSUPPORTED: 'JPG·PNG·WebP 이미지만 쓸 수 있습니다.',
  COVER_TOO_LARGE: '이미지가 너무 큽니다.',
  UNAUTHORIZED: '로그인이 필요합니다. 다시 로그인해 주세요.',
};

/** 오류 코드가 "서버에 반영됐는지 모르는" 종류인가(네트워크·5xx·알 수 없는 코드). 이때 목록을 다시 읽는다 */
export function isSongEditUncertain(code: string): boolean {
  return !(code in SONG_EDIT_ERROR_TEXT);
}

/** 오류 코드 → 문구. 표에 없으면 "결과를 확인하지 못했습니다" */
export function songEditErrorText(code: string): string {
  return SONG_EDIT_ERROR_TEXT[code] ?? SONG_EDIT_UNCERTAIN_TEXT;
}
