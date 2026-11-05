// TopBar 기본 제목(라우트별 상수). 페이지가 useShell로 제목을 알리지 않았을 때 쓴다.

/** 페이지가 제목을 알리지 않았을 때 쓰는 라우트별 기본 제목(앞부분 일치, 위에서부터) */
export const DEFAULT_TITLES: ReadonlyArray<readonly [string, string]> = [
  ['/free', '자유 연습'],
  ['/play', '리듬 게임'],
  ['/sheet', '악보 연습'],
  ['/studio', '내 곡'],
  ['/history', '연주 기록'],
  ['/setup', '드럼 세팅'],
  ['/settings', '설정'],
  ['/result', '결과'],
  ['/admin/songs', '공용 곡 관리'],
];

export function defaultTitle(pathname: string): string {
  return DEFAULT_TITLES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? '';
}
