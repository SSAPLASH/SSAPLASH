// 미니게임 경로·주소 값과 게임 id (설계 MODE-006-minigame-speed 3절, MODE-006-minigame-list-ui 3절).
// 사이드바 하위 메뉴(components/shell/nav/Sidebar)·리듬 게임 곡 고르기(features/play SongPicker)·features/mini가 서로를 모른 채 같은 값을 쓰도록 여기에 둔다.
// 게임 이름·규칙 문구와 어느 게임이 목록에 보이는지는 기능 폴더(features/mini)가 가진다.

/** 미니게임 목록 경로. `/play` 아래라 사이드바의 「리듬 게임」 활성 표시가 그대로 맞는다 */
export const MINI_PATH = '/play/mini';

/** 목록에서 고른 게임을 남기는 주소 값 이름(`/play/mini?game=tempo`). 고른 게임의 기준은 이 주소 값 하나다 */
export const MINI_GAME_PARAM = 'game';

/** 게임 id 전체. 순서는 뜻이 없다(보이는 순서는 목록 표가 정한다). 뒤의 게임이 자기 id를 더한다 */
export const MINI_GAME_IDS = ['speed', 'dynamics', 'sight', 'tempo', 'crescendo', 'oneshot'] as const;

/** 게임 id */
export type MiniGameId = (typeof MINI_GAME_IDS)[number];

/** 게임 화면 경로. 한 게임의 안내·카운트다운·플레이·결과는 이 경로 안의 단계다 */
export function miniGamePath(id: MiniGameId): string {
  return `${MINI_PATH}/${id}`;
}

/** 미니게임 목록이거나 그 아래 경로인가 */
export function isMiniPath(pathname: string): boolean {
  return pathname === MINI_PATH || pathname.startsWith(`${MINI_PATH}/`);
}

/** 글자가 게임 id면 그 id, 아니면 null(주소 값·경로 조각을 믿기 전에 거른다) */
export function parseMiniGameId(value: string | null | undefined): MiniGameId | null {
  return MINI_GAME_IDS.find((id) => id === value) ?? null;
}

/** 목록 주소. 게임 id를 넘기면 그 게임을 고른 목록이고, 넘기지 않으면 주소 값 없는 목록이다 */
export function miniListPath(id?: MiniGameId | null): string {
  return id ? `${MINI_PATH}?${MINI_GAME_PARAM}=${id}` : MINI_PATH;
}

/** 게임 화면 경로(`/play/mini/{게임 id}`)의 게임 id. 목록이거나 다른 경로면 null */
export function miniGameOfPath(pathname: string): MiniGameId | null {
  const prefix = `${MINI_PATH}/`;
  if (!pathname.startsWith(prefix)) return null;
  return parseMiniGameId(pathname.slice(prefix.length).split('/')[0]);
}
