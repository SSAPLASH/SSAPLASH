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

/** 카드 ⋯ 메뉴의 편집 종류 */
export type SongEditKind = 'cover' | 'meta' | 'delete';

/** 곡 ⋯ 메뉴의 악보 항목(설계 CHART-001 악보 보관 D7): 연결된 악보가 있으면 보기, 없으면 올리기 */
export type SongSheetKind = 'sheetView' | 'sheetUpload';

/**
 * 곡 상태별 ⋯ 메뉴 항목(D5): 완료 = 커버·곡 정보·삭제, 실패 = 삭제만, 처리 중·알 수 없는 상태 = 없음.
 * sheet를 주면(악보-곡 연결 스위치 켜짐) 완료 곡 메뉴 맨 앞에 [악보 보기](sheetId 있음) 또는 [악보 올리기](없음)를 넣는다(Figma 순서). 주지 않으면 그대로다.
 */
export function menuKinds(status: string, sheet?: { sheetId: number | null }): (SongEditKind | SongSheetKind)[] {
  if (status === 'READY') {
    if (!sheet) return ['cover', 'meta', 'delete'];
    return [sheet.sheetId != null ? 'sheetView' : 'sheetUpload', 'cover', 'meta', 'delete'];
  }
  if (status === 'FAILED') return ['delete'];
  return [];
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
  COVER_UNAVAILABLE: '지금은 커버를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  UNAUTHORIZED: '로그인이 필요합니다. 다시 로그인해 주세요.',
};

/** 오류 코드가 "서버에 반영됐는지 모르는" 종류인가(네트워크·5xx·알 수 없는 코드). 이때 목록을 다시 읽는다 */
export function isSongEditUncertain(code: string): boolean {
  return !(code in SONG_EDIT_ERROR_TEXT);
}

/** 5xx지만 반영되지 않은 것이 확실한 코드(저장소 장애로 저장 전에 실패). 이 밖의 5xx는 결과를 모른다 */
const KNOWN_SERVER_FAILURES: ReadonlySet<string> = new Set(['COVER_UNAVAILABLE']);

/** 실패 응답(status·code) → 창에 보일 문구와 결과를 모르는지. 네트워크는 status 0 */
export function songEditFailure(status: number, code: string): { text: string; uncertain: boolean } {
  if (status >= 500 && !KNOWN_SERVER_FAILURES.has(code)) return { text: SONG_EDIT_UNCERTAIN_TEXT, uncertain: true };
  return { text: songEditErrorText(code), uncertain: isSongEditUncertain(code) };
}

/** 오류 코드 → 문구. 표에 없으면 "결과를 확인하지 못했습니다" */
export function songEditErrorText(code: string): string {
  return SONG_EDIT_ERROR_TEXT[code] ?? SONG_EDIT_UNCERTAIN_TEXT;
}
