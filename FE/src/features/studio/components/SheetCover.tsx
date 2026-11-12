// 악보 항목 커버 (설계 CHART-001 악보 보관 4-2). 이미지 악보는 1쪽 썸네일, PDF·썸네일 없음·불러오기 실패는 악보 아이콘 자리표시.
// 크기는 곡 커버(.song-cover)와 같은 틀을 써서 카드·행이 곡과 정렬된다.
import { useState } from 'react';
import type { SheetSummary } from '@/features/studio/domain/sheetMusic';

interface Props {
  sheet: SheetSummary;
  /** 썸네일 서명 URL이 만료돼 못 불러왔을 때 호출자가 목록을 다시 읽는다 */
  onImageError?: () => void;
}

export function SheetCover({ sheet, onImageError }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = sheet.thumbnailUrl;
  if (url && url !== failedUrl) {
    return (
      <span className="song-cover">
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => {
            setFailedUrl(url);
            onImageError?.();
          }}
        />
      </span>
    );
  }
  return (
    <span className="song-cover default studio-sheet-placeholder" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="40%" height="40%" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4" />
        <path d="M9 12h6M9 15h6M9 18h4" />
      </svg>
    </span>
  );
}
