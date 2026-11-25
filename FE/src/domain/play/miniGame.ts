// 미니게임 경로와 게임 id (설계 MODE-006-minigame-speed 3절).
// 사이드바 하위 메뉴(components/shell/nav/Sidebar)·리듬 게임 곡 고르기(features/play SongPicker)·features/mini가 서로를 모른 채 같은 값을 쓰도록 여기에 둔다.
// 게임 이름·규칙 문구는 기능 폴더(features/mini/domain/miniCatalog)가 가진다.

/** 미니게임 목록 경로. `/play` 아래라 사이드바의 「리듬 게임」 활성 표시가 그대로 맞는다 */
export const MINI_PATH = '/play/mini';

/** 게임 id. 뒤의 게임(406~409)이 자기 id를 더한다 */
export type MiniGameId = 'speed' | 'dynamics' | 'sight' | 'tempo' | 'oneshot';

/** 게임 화면 경로. 한 게임의 안내·카운트다운·플레이·결과는 이 경로 안의 단계다 */
export function miniGamePath(id: MiniGameId): string {
  return `${MINI_PATH}/${id}`;
}

/** 미니게임 목록이거나 그 아래 경로인가 */
export function isMiniPath(pathname: string): boolean {
  return pathname === MINI_PATH || pathname.startsWith(`${MINI_PATH}/`);
}
