// 추천 곡·비슷한 곡 줄 (설계 COACH-004-song-recommend-picker 2장·D9, COACH-004-similar-songs D7). 그리기와 클릭 전달만 한다 — store·api를 모른다.
// 카드 = 커버 · 제목 · 아티스트 · 연습 단계 배지 · 이유 한 줄(card.line, 비면 줄 없음). items가 비면 아무것도 그리지 않는다.
import type { RecommendCard } from '@/domain/song/recommendation';
import { artistLabel } from '@/domain/song/songCatalog';
import { LevelBadge } from '@/components/song/LevelBadge';
import { SongCover } from '@/components/song/SongCover';
import '@/components/song/song.css';

interface Props {
  items: RecommendCard[];
  onPick: (card: RecommendCard) => void;
  /** 줄 제목. 기본 "추천곡"(리포트는 "추천 곡" 또는 "이 약점 연습하기") */
  caption?: string;
}

export function RecommendRow({ items, onPick, caption = '추천곡' }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="song-reco" aria-label={caption}>
      <h3 className="song-reco-caption">
        <span className="song-reco-spark" aria-hidden="true">
          ✦
        </span>
        {caption}
      </h3>
      <div className="song-reco-list">
        {items.map((item) => (
          <button key={`${item.song.id}:${item.chartId}`} type="button" className="song-reco-card" onClick={() => onPick(item)}>
            <SongCover coverUrl={item.song.coverUrl} />
            <span className="song-reco-title">{item.song.title}</span>
            <span className="song-reco-artist">{artistLabel(item.song.artist)}</span>
            <LevelBadge level={item.difficulty} size="sm" />
            {item.line !== '' && <span className="song-reco-reason">{item.line}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
