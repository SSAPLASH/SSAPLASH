// 추천 곡 줄 (설계 COACH-004-song-recommend-picker 2장·D9). 그리기와 클릭 전달만 한다 — store·api를 모른다.
// 카드 = 커버 · 제목 · 아티스트 · 연습 단계 배지 · 이유 한 줄. items가 비면 아무것도 그리지 않는다.
import { primaryReason, type RecommendationItem } from '@/domain/recommendation';
import { LevelBadge } from './LevelBadge';
import { SongCover } from './SongCover';
import './song.css';

interface Props {
  items: RecommendationItem[];
  onPick: (item: RecommendationItem) => void;
}

export function RecommendRow({ items, onPick }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="song-reco" aria-label="추천 곡">
      <h3 className="song-reco-caption">추천 곡</h3>
      <div className="song-reco-list">
        {items.map((item) => (
          <button key={`${item.song.id}:${item.chartId}`} type="button" className="song-reco-card" onClick={() => onPick(item)}>
            <SongCover coverUrl={item.song.coverUrl} />
            <span className="song-reco-title">{item.song.title}</span>
            <span className="song-reco-artist">{item.song.artist}</span>
            <LevelBadge level={item.difficulty} size="sm" />
            <span className="song-reco-reason">{primaryReason(item)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
