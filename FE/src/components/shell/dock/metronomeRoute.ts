// 메트로놈 조작을 막는 라우트 판정. 리듬 게임(/play)은 곡 중 클릭을 내지 않으므로 Dock·패널의 토글·BPM·박자·탭을 비활성으로 둔다
// (설계 MODE-001-play-quick-start E1). 악보 연습 등 다른 화면은 지금처럼 곡 중 클릭을 켜고 끈다.
export function metronomeDisabledRoute(pathname: string): boolean {
  return pathname === '/play';
}
