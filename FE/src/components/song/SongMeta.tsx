// 곡 메타 한 줄: 아티스트 · BPM · 길이. 없는 값은 건너뛴다 — 화면에서는 묶음 2부터 쓴다.
import './song.css';
import { formatDuration } from '@/components/formatTime';

interface Props {
  artist?: string;
  bpm?: number;
  durationSec?: number;
  className?: string;
}

export function SongMeta({ artist, bpm, durationSec, className }: Props) {
  const parts: string[] = [];
  if (artist) parts.push(artist);
  if (bpm !== undefined) parts.push(`${Math.round(bpm)} BPM`);
  if (durationSec !== undefined) parts.push(formatDuration(durationSec * 1000));
  if (parts.length === 0) return null;
  return <p className={className ? `song-meta ${className}` : 'song-meta'}>{parts.join(' · ')}</p>;
}
