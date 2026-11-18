// Figma Studio / SongStatusBadge 202:503 — 내 곡 상태 배지(완료 · 채보 생성 중 · 생성 실패). 알약 모양, 상태색 16% 배경 + 점 + 글자.
import { songStatusView } from '@/domain/song/songCatalog';
import './SongStatusBadge.css';

interface Props {
  status: string;
  /** 글자를 상태 기본 문구 대신 쓴다(예: 반주 고르기 창의 「반주 만드는 중」). 색·점은 status를 따른다 */
  label?: string;
}

export function SongStatusBadge({ status, label }: Props) {
  const view = songStatusView(status);
  // 상태 → 색: READY 완료(good), PROCESSING 생성 중(brand), FAILED 실패(miss). 모르는 상태는 완료 색
  const tone = view.tone === 'active' ? 'active' : view.tone === 'danger' ? 'danger' : 'ok';
  return (
    <span className={`studio-badge studio-badge-${tone}`}>
      <span className="studio-badge-dot" aria-hidden="true" />
      {label ?? view.label}
    </span>
  );
}
