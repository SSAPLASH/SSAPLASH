// 곡 즐겨찾기 별 (설계 MODE-001-MODE-003-song-favorite 화면 사양). 곡 선택 표의 행과 선택한 곡 패널의 커버가 같이 쓴다.
// props만 받는다 — 저장은 호출자(useSongFavorites)가 한다. 눌러도 행 선택·더블클릭 시작이 일어나지 않게 이벤트를 여기서 멈춘다.
import { useState } from 'react';
import './favorite-button.css';

interface IconProps {
  filled: boolean;
  size?: number;
}

/** 별 아이콘. 채운 별은 즐겨찾기한 곡·켜진 필터, 빈 별은 그 반대다. 색은 글자색을 따른다 */
export function StarIcon({ filled, size = 20 }: IconProps) {
  return (
    <svg
      className="play-fav-icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
    >
      <path d="M10 2.6l2.3 4.67 5.15.75-3.73 3.63.88 5.13L10 14.36l-4.6 2.42.88-5.13L2.55 8.02l5.15-.75L10 2.6z" />
    </svg>
  );
}

interface Props {
  /** 즐겨찾기한 곡인지 */
  on: boolean;
  onToggle: () => void;
  /** row: 표의 행(36), cover: 선택한 곡 패널의 커버 오른쪽 위(36, 둥근 반투명 바탕) */
  size?: 'row' | 'cover';
  tabIndex?: number;
}

export function FavoriteButton({ on, onToggle, size = 'row', tabIndex }: Props) {
  // 방금 켰을 때만 별이 한 번 커졌다 돌아온다(목록이 다시 그려질 때는 움직이지 않는다)
  const [pop, setPop] = useState(false);
  const label = on ? '즐겨찾기 해제' : '즐겨찾기에 추가';
  return (
    <button
      type="button"
      className={['play-fav', `play-fav-${size}`, on ? 'on' : '', pop ? 'pop' : ''].filter(Boolean).join(' ')}
      aria-pressed={on}
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
      onClick={(e) => {
        e.stopPropagation();
        setPop(!on);
        onToggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onAnimationEnd={() => setPop(false)}
    >
      <StarIcon filled={on} />
    </button>
  );
}
