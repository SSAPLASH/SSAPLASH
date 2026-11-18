// 소리 끔·켬 장식 아이콘(스피커). Dock의 SoundToggle과 일시정지 팝업 음량 줄이 같은 그림을 쓴다. 눌러지지 않는 장식이라 aria-hidden.
interface Props {
  /** true면 소리 켬(음파), false면 소리 끔(엑스) */
  on: boolean;
  size?: number;
}

export function SoundIcon({ on, size = 20 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9z" />
      {on ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
    </svg>
  );
}
