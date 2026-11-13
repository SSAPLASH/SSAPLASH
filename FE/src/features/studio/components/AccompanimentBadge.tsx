// 내 곡 반주 상태 배지 (설계 CHART-002 반주 상태 2절). Figma SongStatusBadge 202:503에 반주 변형이 없어 processing·failed 모양을 그대로 쓴다.
// 채보 READY 곡의 생성 중·실패만 그리고, 그 밖에는 아무것도 그리지 않는다. 대기 애니메이션은 미정(설계 U1).
import { accompanimentView, type AccompanimentStatus } from '@/domain/song/songCatalog';

interface Props {
  songStatus: string;
  accompanimentStatus: AccompanimentStatus;
  onRetry?: () => void;
  retrying?: boolean;
}

export function AccompanimentBadge({ songStatus, accompanimentStatus, onRetry, retrying = false }: Props) {
  const view = accompanimentView(songStatus, accompanimentStatus);
  if (!view) return null;
  const tone = view.tone === 'danger' ? 'danger' : 'active';
  if (accompanimentStatus === 'FAILED' && onRetry) {
    return (
      <button type="button" className={`studio-badge studio-badge-${tone} studio-badge-retry`} aria-label="반주 생성 다시 시도" title="반주 생성 다시 시도" disabled={retrying} onClick={onRetry}>
        <span className="studio-badge-dot" aria-hidden="true" />
        {view.label}
      </button>
    );
  }
  return (
    <span className={`studio-badge studio-badge-${tone}`}>
      <span className="studio-badge-dot" aria-hidden="true" />
      {view.label}
    </span>
  );
}
