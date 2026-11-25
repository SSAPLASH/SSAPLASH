// 메트로놈 조작을 막는 라우트 판정. 리듬 게임(/play)은 곡 중 클릭을 내지 않으므로 Dock·패널의 토글·BPM·박자·탭을 비활성으로 둔다
// (설계 MODE-001-play-quick-start E1). 악보 연습 등 다른 화면은 지금처럼 곡 중 클릭을 켜고 끈다.
// 미니게임 「인간 메트로놈」도 막는다: 소리가 꺼진 뒤 빠르기를 지키는 게임이라 메트로놈을 켤 수 있으면 성립하지 않는다(설계 MODE-006-minigame-tempo D8).
// 「정적 뒤 한 방」도 같다: 정적 동안 메트로놈이 박을 세어 주면 안 된다(설계 MODE-006-minigame-oneshot D13).
import { miniGamePath } from '@/domain/play/miniGame';

export function metronomeDisabledRoute(pathname: string): boolean {
  return pathname === '/play' || pathname === miniGamePath('tempo') || pathname === miniGamePath('oneshot');
}
