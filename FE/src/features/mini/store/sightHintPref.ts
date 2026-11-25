// 「악보 보고 빨리 치기」에서 마지막에 고른 힌트 값 (설계 MODE-006-minigame-sight 3절 「힌트 값 저장」). 브라우저 localStorage에 둔다.
// 기록이 아니라 화면 설정이라 계정별로 나누지 않는다. 읽거나 쓰지 못하면 켬으로 진행한다(예외를 삼킨다).
import type { SightHint } from '@/features/mini/domain/sightRound';

const KEY = 'ssaplash.mini.sightHint.v1';

/** 저장된 힌트 값. 없거나 다른 값이면 켬 */
export function readSightHint(): SightHint {
  try {
    return localStorage.getItem(KEY) === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

/** 힌트 값을 저장한다. 안내에서 힌트를 바꿀 때 부른다 */
export function writeSightHint(hint: SightHint): void {
  try {
    localStorage.setItem(KEY, hint);
  } catch {
    // 저장 공간이 막혔다. 이번 접속에서는 고른 값으로 진행한다
  }
}
