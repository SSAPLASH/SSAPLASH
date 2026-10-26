// 아직 관찰 대상이 연결되지 않은 단계(④ 판정·⑤ 채점·⑥ 출력·타격 추적)의 공용 안내.
import { PENDING_REASON } from '../layout/sections';

export function PendingSection({ title }: { title: string }) {
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">{title}</h2>
      <p className="faint mon-empty">{PENDING_REASON}.</p>
    </div>
  );
}
