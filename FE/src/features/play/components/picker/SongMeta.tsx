// 곡 메타 한 줄: 아티스트 · BPM · 길이 · 곡 난이도. 없는 값은 건너뛴다 — 화면에서는 묶음 2부터 쓴다.
import '@/components/song/song.css';
import { formatDuration } from '@/domain/time/formatTime';

interface Props {
  artist?: string;
  bpm?: number;
  durationSec?: number;
  /** 곡 난이도 표기(입문/중급/고급). 연습 단계가 아니다 */
  level?: string;
  className?: string;
}

export function SongMeta({ artist, bpm, durationSec, level, className }: Props) {
  const parts: string[] = [];
  if (artist) parts.push(artist);
  if (bpm !== undefined) parts.push(`BPM ${Math.round(bpm)}`);
  if (durationSec !== undefined) parts.push(formatDuration(durationSec * 1000));
  if (level) parts.push(level);
  if (parts.length === 0) return null;
  return <p className={className ? `song-meta ${className}` : 'song-meta'}>{parts.join(' · ')}</p>;
}
