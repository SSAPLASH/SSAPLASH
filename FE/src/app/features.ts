// 빌드 시 기능 스위치. BE가 아직 없는 기능의 UI를 숨기는 용도다.

/**
 * 내 곡 편집(커버 변경·표시명 변경·곡 삭제) 사용 여부. 기본은 켜짐이고 VITE_SONG_EDIT=false로 빌드할 때만 ⋯ 메뉴를 숨긴다.
 * BE 개인 곡 관리 API(187)가 배포돼 운영에서 켠다(280).
 */
export const SONG_EDIT_ENABLED = import.meta.env.VITE_SONG_EDIT !== 'false';

/**
 * 연주 녹음(녹음 버튼·저장 창·녹음 보관함) 사용 여부. 기본은 꺼짐이고 VITE_RECORDING=true로 빌드할 때만 켠다.
 * BE 보관함 API(257)가 운영에 배포되고 UI가 끝난 뒤 켜짐으로 바꾼다(설계 REC-001 U6).
 */
export const RECORDING_ENABLED = import.meta.env.VITE_RECORDING === 'true';
