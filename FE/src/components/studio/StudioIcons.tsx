// 라이브러리 화면 전용 아이콘 (Figma Icons / 더보기·닫기·업로드·플러스·재생, 게임·악보). 게임·악보는 사이드바 메뉴와 플레이 모드 메뉴가 같이 쓴다. 현재 글자색을 따르는 선 아이콘이라 크기만 정한다.
interface Props {
  size?: number;
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

export function MoreIcon({ size = 20 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base} fill="currentColor" stroke="none">
      <circle cx="4.5" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="15.5" cy="10" r="1.6" />
    </svg>
  );
}

export function CloseIcon({ size = 20 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function UploadIcon({ size = 32 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" {...base}>
      <path d="M16 21V6M10 12l6-6 6 6" />
      <path d="M5 20v5a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

export function PlusIcon({ size = 20 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export function PlayIcon({ size = 24 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} fill="currentColor" stroke="none">
      <path d="M8 5.5v13l10.5-6.5z" />
    </svg>
  );
}

// 플레이 모드 메뉴(studio/PlayModeMenu)의 항목 아이콘 20px. 경로는 Figma 원본 그대로이고, 원본이 칸 왼쪽 위에 붙어 있어 가운데로 옮겨 그린다.
// 사이드바의 「리듬 게임」·「악보 연습」 아이콘과는 모양이 다르다(사이드바는 이 작업 범위 밖).
const menuIconBase = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

/** 리듬 게임(게임패드) — Figma Icons / 게임 126:1796 */
export function GameIcon({ size = 20 }: Props) {
  return (
    <svg width={size} height={size} {...menuIconBase}>
      <path
        transform="translate(2.5 4.4)"
        d="M2.5 4.16667H4.16667M4.16667 4.16667H5.83333M4.16667 4.16667V2.5M4.16667 4.16667V5.83333M10.8333 3.33333H10.9167M12.5 5.83333H12.5833M3.33333 0H11.6667C14.1667 0 15 3.33333 15 7.5C15 10.8333 12.5 11.6667 10 8.33333H5C2.5 11.6667 0 10.8333 0 7.5C0 3.33333 0.833333 0 3.33333 0Z"
      />
    </svg>
  );
}

/** 악보 연습(음표) — Figma Icons / 악보 126:1799 */
export function SheetIcon({ size = 20 }: Props) {
  return (
    <svg width={size} height={size} {...menuIconBase}>
      <path
        transform="translate(2.9 2.5)"
        d="M5 12.5V4.16667M5 12.5C5 15.8333 0 15.8333 0 13.3333C0 10.8333 5 10 5 12.5ZM5 4.16667V1.66667L14.1667 0V2.5M5 4.16667L14.1667 2.5M14.1667 2.5V10.8333M14.1667 10.8333C14.1667 14.1667 9.16667 14.1667 9.16667 11.6667C9.16667 9.16667 14.1667 8.33333 14.1667 10.8333Z"
      />
    </svg>
  );
}
