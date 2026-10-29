// 곡 커버 (설계 CHART-001 2). coverUrl이 있으면 이미지, 없거나 불러오지 못하면 제목에서 정한 색 + 첫 글자의 기본 커버.
import { useState } from 'react';
import { defaultCover } from '@/domain/songCover';

interface Props {
  title: string;
  coverUrl: string | null;
  className?: string;
}

export function SongCover({ title, coverUrl, className }: Props) {
  // 불러오지 못한 URL은 기본 커버로 대체한다(URL이 바뀌면 다시 시도)
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cls = ['song-cover', className].filter(Boolean).join(' ');

  if (coverUrl && coverUrl !== failedUrl) {
    return (
      <span className={cls}>
        <img src={coverUrl} alt="" loading="lazy" onError={() => setFailedUrl(coverUrl)} />
      </span>
    );
  }
  const { hue, letter } = defaultCover(title);
  return (
    <span
      className={`${cls} default`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 28%))` }}
      aria-hidden="true"
    >
      <span className="song-cover-letter">{letter}</span>
    </span>
  );
}
