// 「삭제된 곡」 칩 — 결과 요약 카드 제목 옆·연주 기록 행 제목 옆(Figma Navigation / HistoryRow song=deleted).
import './song.css';
import { DELETED_SONG_LABEL } from '@/domain/song/songAvailability';

export function DeletedSongChip({ className }: { className?: string }) {
  return <span className={className ? `song-deleted-chip ${className}` : 'song-deleted-chip'}>{DELETED_SONG_LABEL}</span>;
}
