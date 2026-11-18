// 총평 카드 — Figma Feedback / CoachSummaryCard 605:31287. summary가 없으면 그리지 않는다.
import { summaryBadge, type CoachSummary } from '@/domain/play/report';

export function CoachSummaryCard({ summary }: { summary: CoachSummary | null }) {
  if (!summary) return null;
  const badge = summaryBadge(summary.level);
  return (
    <div className="card col coach-summary">
      <div className="coach-summary-head">
        <h3>코치의 한마디</h3>
        {badge && <span className={`weak-badge tone-${badge.tone}`}>{badge.text}</span>}
        <span className="small dim">AI가 작성했어요</span>
      </div>
      <p className="coach-summary-text">{summary.text}</p>
    </div>
  );
}
