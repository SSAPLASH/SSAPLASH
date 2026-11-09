// Dock을 보이는 라우트 판정. 드럼을 치는 연주 화면(자유 모드·리듬게임·악보 연습)에서만 둔다(QA 352).
// 접두사가 아니라 정확 일치로 본다. 컴포넌트 파일에서 함수를 같이 내보내면 fast refresh 경고가 나서 따로 둔다.
export function dockVisible(pathname: string): boolean {
  return pathname === '/free' || pathname === '/play' || pathname === '/sheet';
}
