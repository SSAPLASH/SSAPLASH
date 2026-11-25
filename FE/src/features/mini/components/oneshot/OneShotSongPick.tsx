// 「정적 뒤 한 방」 곡 고르기. 곡이 하나면 이름 한 줄, 둘 이상이면 세그먼트. 판이 도는 동안(locked)에는 바꿀 수 없다.
import { Segmented } from '@/components/ui/form/Segmented';
import type { OneShotSong } from '@/features/mini/domain/oneShotSongs';
import './oneshot.css';

interface Props {
  songs: readonly Pick<OneShotSong, 'id' | 'name' | 'artist'>[];
  /** 고른 곡 id */
  value: string;
  /** 참이면 바꿀 수 없다(판이 도는 동안) */
  locked?: boolean;
  onChange?: (id: string) => void;
}

export function OneShotSongPick({ songs, value, locked = false, onChange }: Props) {
  if (songs.length === 0) return null;

  if (songs.length === 1) {
    const [song] = songs;
    return (
      <p className="mini-oneshot-song" data-testid="mini-oneshot-song">
        {song.name} · {song.artist}
      </p>
    );
  }

  return (
    <div className="mini-oneshot-pick" data-testid="mini-oneshot-pick">
      <Segmented
        label="곡"
        value={value}
        onChange={(id) => onChange?.(id)}
        options={songs.map((s) => ({ value: s.id, label: s.name, disabled: locked }))}
      />
    </div>
  );
}
