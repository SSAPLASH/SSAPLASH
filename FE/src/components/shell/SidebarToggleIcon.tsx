// 사이드바 접기·펼치기 아이콘(Lucide panel-left-close, MIT). 패널 테두리·세로줄은 고정이고 화살표 path만 접힘 때 180° 회전한다(D11, UX-23).
// 두 아이콘을 바꿔 끼우면 방향이 뒤집히고, 전체를 돌리면 세로줄이 반대편으로 가므로 화살표만 돌린다. 회전은 CSS(.side-toggle-arrow).
interface Props {
  /** 접힌 상태면 화살표가 오른쪽을 가리킨다 */
  collapsed: boolean;
}

export function SidebarToggleIcon({ collapsed }: Props) {
  return (
    <svg
      className="side-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path className={`side-toggle-arrow${collapsed ? ' collapsed' : ''}`} d="m16 15-3-3 3-3" />
    </svg>
  );
}
