// 라이브러리 화면 전용 아이콘 (Figma Icons / 더보기·닫기·업로드·플러스·재생). 현재 글자색을 따르는 선 아이콘이라 크기만 정한다.
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
