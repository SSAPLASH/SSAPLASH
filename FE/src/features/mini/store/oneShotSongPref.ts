// 「정적 뒤 한 방」에서 마지막에 고른 곡 (설계 MODE-006-minigame-oneshot 3절 「곡 기억」). 브라우저 localStorage에 둔다.
// 기록이 아니라 화면 설정이라 계정별로 나누지 않는다. 읽거나 쓰지 못하면 첫 곡으로 진행한다(예외를 삼킨다).
import { songById } from '@/features/mini/domain/oneShotSongs';

const KEY = 'ssaplash.mini.oneShotSong.v1';

/** 저장된 곡 id. 없거나 곡 표에 없는 값이면 첫 곡 */
export function readOneShotSong(): string {
  try {
    return songById(localStorage.getItem(KEY)).id;
  } catch {
    return songById(null).id;
  }
}

/** 고른 곡을 저장한다. 안내에서 곡을 바꿀 때 부른다 */
export function writeOneShotSong(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // 저장 공간이 막혔다. 이번 접속에서는 고른 곡으로 진행한다
  }
}
