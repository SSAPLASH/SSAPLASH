// 빌드 시 기능 스위치. BE가 아직 없는 기능의 UI를 숨기는 용도다.

/**
 * 내 곡 편집(커버 변경·표시명 변경·곡 삭제) 사용 여부. VITE_SONG_EDIT=true로 빌드할 때만 ⋯ 메뉴가 보인다.
 * BE 개인 곡 관리 API(187)가 배포되기 전에는 꺼 둔다. 기본은 꺼짐이다.
 */
export const SONG_EDIT_ENABLED = import.meta.env.VITE_SONG_EDIT === 'true';
