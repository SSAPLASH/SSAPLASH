// 미니게임 목록 표 (설계 MODE-006-minigame-speed 3절). 목록에는 구현된 게임만 둔다(D15) — 뒤의 게임은 여기에 한 줄을 더하면 카드가 나타난다.
// 카드·안내의 그림은 부품이라 여기에 둘 수 없다(목록 화면이 게임 id로 고른다).
import type { MiniGameId } from '@/domain/play/miniGame';
import { formatDynamicsScore } from './dynamicsRound';
import type { MiniBetter } from './miniRecord';
import { SIGHT_VARIANTS, formatSeconds } from './sightRound';

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
    unit: '타',
    better: 'higher',
  },
  {
    id: 'dynamics',
    name: '강약중강약',
    rule: '내 세기를 재고 숫자에 맞춰 세 번 치기',
    tag: '3타',
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
    unit: 'ms',
    better: 'lower',
  },
];

/** 게임 id의 목록 표 한 줄 */
export function miniGameInfo(id: MiniGameId): MiniGameInfo {
  const info = MINI_CATALOG.find((game) => game.id === id);
  if (!info) throw new Error(`목록 표에 없는 미니게임: ${id}`);
  return info;
}

/** 점수를 화면 글자로. 표시 형식이 없으면 숫자 그대로 */
export function formatMiniScore(info: Pick<MiniGameInfo, 'format'>, score: number): string {
  return info.format ? info.format(score) : String(score);
}
