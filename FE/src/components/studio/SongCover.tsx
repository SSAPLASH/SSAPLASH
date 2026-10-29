// 곡 커버 (설계 CHART-001 2, v0.4). coverUrl이 있으면 직접 올린 이미지, 없거나 불러오지 못하면 모든 곡에 같은 CD 기본 커버.
import { useId, useState } from 'react';

interface Props {
  coverUrl: string | null;
  className?: string;
}

export function SongCover({ coverUrl, className }: Props) {
  // 불러오지 못한 URL은 기본 커버로 대체한다(URL이 바뀌면 다시 시도)
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cls = ['song-cover', className].filter(Boolean).join(' ');

  if (coverUrl && coverUrl !== failedUrl) {
    return (
      <span className={cls}>
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          onError={() => {
            setFailedUrl(coverUrl);
          }}
        />
      </span>
    );
  }
  return (
    <span className={`${cls} default`} aria-hidden="true">
      <DiscArt />
    </span>
  );
}

/** 기본 커버 그림: 무대 배경 위 CD 한 장(홈·라벨·빛 반사) */
function DiscArt() {
  // 카드마다 그려지므로 그라데이션 id가 겹치지 않게 한다
  const sheen = useId();
  return (
    <svg className="song-cover-disc" viewBox="0 0 100 100" focusable="false">
      <defs>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="0.42" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.62" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="34" className="disc-body" />
      <circle cx="50" cy="50" r="34" fill={`url(#${sheen})`} />
      <circle cx="50" cy="50" r="28" className="disc-groove" />
      <circle cx="50" cy="50" r="21" className="disc-groove" />
      <circle cx="50" cy="50" r="12" className="disc-label" />
      <circle cx="50" cy="50" r="3.2" className="disc-hole" />
    </svg>
  );
}
