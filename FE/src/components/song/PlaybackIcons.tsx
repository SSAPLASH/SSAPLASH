// 곡 재생 부품 아이콘 (Figma 시안 C · 애플 스타일 조작부). 라이브러리 재생바와 자유 연습 반주 바가 같이 쓴다. 현재 글자색을 따른다.
interface Props {
  size?: number;
}

/** 재생 글리프 30px (Figma 시안 C play-pause 971:50779) */
export function PlayGlyph({ size = 30 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8.75 5.625V24.375L25 15L8.75 5.625Z" />
    </svg>
  );
}

/** 일시정지 글리프 30px (Figma 시안 C play-pause 971:50693) */
export function PauseGlyph({ size = 30 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M11.25 5.625H8.75C8.05964 5.625 7.5 6.18464 7.5 6.875V23.125C7.5 23.8154 8.05964 24.375 8.75 24.375H11.25C11.9404 24.375 12.5 23.8154 12.5 23.125V6.875C12.5 6.18464 11.9404 5.625 11.25 5.625Z" />
      <path d="M21.25 5.625H18.75C18.0596 5.625 17.5 6.18464 17.5 6.875V23.125C17.5 23.8154 18.0596 24.375 18.75 24.375H21.25C21.9404 24.375 22.5 23.8154 22.5 23.125V6.875C22.5 6.18464 21.9404 5.625 21.25 5.625Z" />
    </svg>
  );
}

const TEN = { x: 12, y: 14.6, textAnchor: 'middle', fontSize: 7, fontWeight: 700, fill: 'currentColor', stroke: 'none' } as const;

/** 10초 뒤로 24px (Figma 시안 C 971:50688: 반시계 화살표 원 + 가운데 「10」) */
export function Back10Icon({ size = 24 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 4.5C13.5878 4.49881 15.135 5.00156 16.4188 5.93585C17.7026 6.87015 18.6568 8.18777 19.1439 9.69899C19.6311 11.2102 19.626 12.837 19.1295 14.3452C18.633 15.8534 17.6707 17.1651 16.3811 18.0914C15.0916 19.0177 13.5413 19.5109 11.9535 19.4998C10.3658 19.4888 8.82247 18.9741 7.54589 18.03C6.26931 17.0858 5.32531 15.7609 4.84982 14.246C4.37434 12.731 4.39191 11.1043 4.9 9.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M12 1.8V7.2L8.4 4.5L12 1.8Z" fill="currentColor" />
      <text {...TEN}>10</text>
    </svg>
  );
}

/** 10초 앞으로 24px (Figma 시안 C 971:50696) */
export function Forward10Icon({ size = 24 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 4.5C10.4122 4.49881 8.86501 5.00156 7.58119 5.93585C6.29738 6.87015 5.3432 8.18777 4.85606 9.69899C4.36893 11.2102 4.37397 12.837 4.87046 14.3452C5.36696 15.8534 6.32929 17.1651 7.61887 18.0914C8.90845 19.0177 10.4587 19.5109 12.0465 19.4998C13.6342 19.4888 15.1775 18.9741 16.4541 18.03C17.7307 17.0858 18.6747 15.7609 19.1502 14.246C19.6257 12.731 19.6081 11.1043 19.1 9.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M12 1.8V7.2L15.6 4.5L12 1.8Z" fill="currentColor" />
      <text {...TEN}>10</text>
    </svg>
  );
}

/** 곡 목록 열기 20px (Figma 979:4592: 가로줄 3개 + 음표). 반주 바 [바꾸기] */
export function PickListIcon({ size = 20 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.33 5.42H12.5M3.33 9.58H12.5M3.33 13.75H8.33" />
      <circle cx="14.58" cy="14.17" r="2.08" />
      <path d="M16.67 14.17V7.08L18.33 7.92" />
    </svg>
  );
}
