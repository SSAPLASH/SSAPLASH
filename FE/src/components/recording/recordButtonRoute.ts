// 녹음 버튼이 있는 라우트 판정. 접두사가 아니라 정확 일치로 본다(설계 REC-001 6-2).
// 컴포넌트 파일에서 함수를 같이 내보내면 fast refresh 경고가 나서 따로 둔다.
export function recordButtonVisible(pathname: string): boolean {
  return pathname === '/free' || pathname === '/play' || pathname === '/sheet';
}
