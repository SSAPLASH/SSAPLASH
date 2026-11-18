// 연습 단계 배지 EASY·NORM·HARD (Figma Play / LevelBadge 372:1325). 곡 자체의 난이도가 아니라 같은 곡을 얼마나 단순하게 했는지다.
// onClick을 주면 버튼(곡 카드의 단계 고르기)으로, 없으면 표시용 span(HUD·곡 정보)으로 그린다.
// size=sm(577:30466~30470)은 표 안 작은 배지: 높이 16·글자 9, 외곽선·글로우 없이 난이도색 18% 바탕. 기본 md는 그대로다.
import type { Difficulty } from '@/domain/song/chart';
import { LEVEL_LABEL } from '@/domain/song/songCatalog';
import './song.css';

interface Props {
  level: Difficulty;
  /** 버튼일 때 선택 여부. 선택되지 않은 배지는 흐리게 */
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  /** md(기본): HUD·곡 카드 크기. sm: 연주 기록·녹음 보관함 행의 작은 배지 */
  size?: 'md' | 'sm';
}

export function LevelBadge({ level, selected, onClick, disabled, className, size = 'md' }: Props) {
  const cls = [
    'song-level',
    `song-level-${level.toLowerCase()}`,
    size === 'sm' ? 'song-level-sm' : '',
    onClick && !selected ? 'song-level-dim' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  if (!onClick) return <span className={cls}>{LEVEL_LABEL[level]}</span>;
  return (
    <button type="button" className={cls} aria-pressed={selected ?? false} disabled={disabled} onClick={onClick}>
      {LEVEL_LABEL[level]}
    </button>
  );
}
