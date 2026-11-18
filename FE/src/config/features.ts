// 빌드 시 기능 스위치. BE가 아직 없는 기능의 UI를 숨기는 용도다.

/**
 * 내 곡 편집(커버 변경·표시명 변경·곡 삭제) 사용 여부. 기본은 켜짐이고 VITE_SONG_EDIT=false로 빌드할 때만 ⋯ 메뉴를 숨긴다.
 * BE 개인 곡 관리 API(187)가 배포돼 운영에서 켠다(280).
 */
export const SONG_EDIT_ENABLED = import.meta.env.VITE_SONG_EDIT !== 'false';

/**
 * 연주 녹음(녹음 버튼·저장 창·녹음 보관함) 사용 여부. 기본은 켜짐이고 VITE_RECORDING=false로 빌드할 때만 숨긴다.
 * UI 완료·로컬 BE 검증 뒤 2026-11-04 켜짐으로 전환(설계 REC-001 U6).
 */
export const RECORDING_ENABLED = import.meta.env.VITE_RECORDING !== 'false';

/**
 * 내 악보 보관(업로드 창 [악보] 섹션·라이브러리 악보 항목·뷰어) 사용 여부. 기본은 켜짐이고 VITE_SHEET_ARCHIVE=false로 빌드할 때만 숨긴다.
 * BE 내 악보 보관 API(155)가 없는 환경에서 끌 수 있다(278).
 */
export const SHEET_ARCHIVE_ENABLED = import.meta.env.VITE_SHEET_ARCHIVE !== 'false';

/**
 * 악보-곡 연결(곡 ⋯ 메뉴의 악보 항목·업로드의 songId 파트) 사용 여부. 기본은 켜짐이고 VITE_SHEET_SONG_LINK=false로 빌드할 때만 끈다.
 * BE 곡 연결(songId·sheetId, MR !352)이 v3.0에 배포돼 2026-11-09 켜짐으로 전환(278).
 */
export const SHEET_SONG_LINK_ENABLED = import.meta.env.VITE_SHEET_SONG_LINK !== 'false';

/**
 * 악보 나중 연결(악보만 항목의 [곡 올리기]·곡 삭제 시 악보 보존 안내) 사용 여부. 기본은 꺼짐이고 VITE_SHEET_RELINK=true로 빌드할 때만 켠다.
 * BE가 PATCH /sheets/{id}의 songId를 받고 곡 삭제 시 악보를 남기는 11/13 릴리즈(BE 회신 3) 뒤에 켠다(설계 CHART-001 D19).
 */
export const SHEET_RELINK_ENABLED = import.meta.env.VITE_SHEET_RELINK === 'true';
