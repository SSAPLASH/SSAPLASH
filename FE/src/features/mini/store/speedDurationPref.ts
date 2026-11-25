// 「누구보다 빠르게」에서 마지막에 고른 제한 시간 (설계 MODE-006-minigame-speed-ui D7). 브라우저 localStorage에 둔다.
// 기록이 아니라 화면 설정이라 계정별로 나누지 않는다. 읽거나 쓰지 못하면 기본 시간으로 진행한다(예외를 삼킨다).
import { SPEED_DEFAULT_SECONDS, parseSpeedSeconds, type SpeedSeconds } from '@/features/mini/domain/speedRound';

const KEY = 'ssaplash.mini.speedSeconds.v1';

/** 저장된 제한 시간. 없거나 모르는 값이면 기본 시간(10초) */
export function readSpeedSeconds(): SpeedSeconds {
  try {
    return parseSpeedSeconds(localStorage.getItem(KEY));
  } catch {
    return SPEED_DEFAULT_SECONDS;
  }
}

/** 제한 시간을 저장한다. 안내에서 시간을 바꿀 때 부른다 */
export function writeSpeedSeconds(seconds: SpeedSeconds): void {
  try {
    localStorage.setItem(KEY, String(seconds));
  } catch {
    // 저장 공간이 막혔다. 이번 접속에서는 고른 값으로 진행한다
  }
}
