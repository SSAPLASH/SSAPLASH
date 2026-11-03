// 곡 커버 (설계 CHART-001 2). coverUrl이 있으면 직접 올린 이미지, 없거나 불러오지 못하면 모든 곡에 같은 기본 커버(Figma Studio / DefaultCover 202:492).
import { useState } from 'react';
import './song.css';

interface Props {
  coverUrl: string | null;
  className?: string;
  /** 이미지를 불러오지 못했을 때(서명 URL 만료 등). 호출자가 목록을 다시 읽어 새 URL을 받는다(U10) */
  onImageError?: (url: string) => void;
}

export function SongCover({ coverUrl, className, onImageError }: Props) {
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
            onImageError?.(coverUrl);
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

/** 기본 커버 그림: 판 위 원반 한 장(광택·홈 3개·라벨·구멍). 크기는 236 기준 비율로 커버 크기에 맞춰 늘고 준다 */
function DiscArt() {
  return (
    <span className="song-cover-disc">
      <span className="song-cover-groove song-cover-groove-1" />
      <span className="song-cover-groove song-cover-groove-2" />
      <span className="song-cover-groove song-cover-groove-3" />
      <span className="song-cover-label" />
      <span className="song-cover-hole" />
    </span>
  );
}
