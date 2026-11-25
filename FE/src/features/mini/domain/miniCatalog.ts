// 미니게임 목록 표 (설계 MODE-006-minigame-speed 3절). 목록에는 구현된 게임만 둔다(D15) — 뒤의 게임은 여기에 한 줄을 더하면 카드가 나타난다.
// 카드·안내의 그림은 부품이라 여기에 둘 수 없다(목록 화면이 게임 id로 고른다).
// 설명 글(`description`)은 목록의 큰 카드와 게임 화면의 안내가 같이 읽는다(설계 MODE-006-minigame-list-ui D8).
import type { MiniGameId } from '@/domain/play/miniGame';
import { formatDynamicsScore } from './dynamicsRound';
import type { MiniBetter } from './miniRecord';
import { ONE_SHOT_VARIANTS } from './oneShotSongs';
import { SIGHT_VARIANTS, formatSeconds } from './sightRound';
import { COUNT_IN_BEATS, TEMPO_HITS } from './tempoRound';

/** 기록이 갈래별로 따로인 게임의 갈래(407은 힌트 켬·끔, 409는 곡) */
export interface MiniVariant {
  id: string;
  name: string;
}

export interface MiniGameInfo {
  id: MiniGameId;
  name: string;
  /** 카드의 한 줄 규칙 */
  rule: string;
  /** 카드 위의 작은 분류 */
  tag: string;
  /** 게임 방법 설명. 목록의 큰 카드와 시작 전 안내가 같은 글을 보인다 */
  description: string;
  /** 기록 단위 */
  unit: string;
  better: MiniBetter;
  /** 점수를 화면 글자로 바꾼다. 없으면 숫자 그대로 보인다 */
  format?: (score: number) => string;
  /** 기록이 갈래별로 따로인 게임의 갈래. 순서는 카드에 보일 순서다 */
  variants?: readonly MiniVariant[];
}

export const MINI_CATALOG: readonly MiniGameInfo[] = [
  {
    id: 'speed',
    name: '누구보다 빠르게',
    rule: '10초 동안 스네어 가장 많이 치기',
    tag: '10초',
    description: '스네어를 친 것만 셉니다. 카운트다운이 끝나면 바로 시작해요.',
    unit: '타',
    better: 'higher',
  },
  {
    id: 'dynamics',
    name: '강약중강약',
    rule: '내 세기를 재고 숫자에 맞춰 세 번 치기',
    tag: '3타',
    description: '먼저 약·중·강을 한 번씩 쳐서 내 세기를 재요. 그다음 숫자 세 개에 맞춰 칩니다.',
    // 기록은 세 타의 오차 합이다. 단위 글자 없이 앞에 「오차」를 붙여 보인다(14 → 「오차 14」)
    unit: '',
    better: 'lower',
    format: formatDynamicsScore,
  },
  {
    id: 'sight',
    name: '악보 보고 빨리 치기',
    rule: '음표가 뜨면 맞는 패드를 바로 치기',
    tag: '10문제',
    description: '틀리면 0.5초가 더해져요. 음표가 뜨기 전에 치면 그 문제를 다시 내요.',
    unit: '초',
    better: 'lower',
    // 기록은 ms로 두고 초 소수 둘째 자리로 보인다(420 → 「0.42」)
    format: formatSeconds,
    // 힌트를 끈 쪽이 본 기록이라 먼저 둔다
    variants: SIGHT_VARIANTS,
  },
  {
    id: 'tempo',
    name: '인간 메트로놈',
    rule: '소리가 꺼져도 같은 빠르기로 치기',
    tag: '16타',
    description: `예비 박 ${COUNT_IN_BEATS}개를 듣고, 소리가 꺼지면 같은 빠르기로 ${TEMPO_HITS}번 치세요. 어느 패드를 쳐도 돼요.`,
    unit: 'ms',
    better: 'lower',
  },
  {
    id: 'crescendo',
    name: '어디까지 올라가는 거예요?',
    rule: '앞 타격보다 조금씩 더 세게 치기',
    tag: '약하면 끝',
    description: '앞에 친 것보다 조금이라도 세게 쳐야 이어져요. 같거나 약하면 끝나요.',
    unit: '번',
    better: 'higher',
  },
  {
    // 이벤트 스위치(config/miniOneShot)가 켜진 빌드에서만 목록에 보인다. 거르는 일은 목록 화면이 한다
    id: 'oneshot',
    name: '정적 뒤 한 방',
    rule: '노래가 멈춘 뒤 정확한 박에 한 방',
    tag: '이벤트',
    description: '노래가 끊기면 속으로 박을 세다가, 노래가 돌아올 자리에 딱 한 번 치세요. 노래가 끊기기 전에 치면 실패예요.',
    unit: 'ms',
    better: 'lower',
    // 기록은 곡별이다. 갈래는 곡 표의 곡
    variants: ONE_SHOT_VARIANTS,
  },
];

/** 게임 id의 목록 표 한 줄 */
export function miniGameInfo(id: MiniGameId): MiniGameInfo {
  const info = MINI_CATALOG.find((game) => game.id === id);
  if (!info) throw new Error(`목록 표에 없는 미니게임: ${id}`);
  return info;
}

/**
 * 목록에서 고른 게임. 원하는 게임이 보이는 목록에 있으면 그 게임이고, 없거나(주소 값 없음·모르는 값·이 빌드에 없는 게임) null이면 첫 게임이다.
 * 보이는 목록은 비어 있지 않아야 한다
 */
export function selectedGame(games: readonly MiniGameInfo[], wanted: MiniGameId | null): MiniGameInfo {
  return games.find((game) => game.id === wanted) ?? games[0];
}

/** 점수를 화면 글자로. 표시 형식이 없으면 숫자 그대로 */
export function formatMiniScore(info: Pick<MiniGameInfo, 'format'>, score: number): string {
  return info.format ? info.format(score) : String(score);
}
