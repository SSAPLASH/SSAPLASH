// 총평 카드 — Figma Feedback / CoachSummaryCard 605:31287. summary가 없으면 그리지 않는다.
// 첫 문장은 한 줄 헤드라인으로 크게, 나머지는 그 아래 본문으로 둔다(설계 COACH-002-coach-summary-emphasis).
import { useRef } from 'react';
import { summaryBadge, type CoachSummary } from '@/domain/play/report';
import { splitSummary } from '@/features/result/domain/reportView';
import { useFitOneLine } from './useFitOneLine';

/** 헤드라인 글자 크기(px): 26에서 시작해 한 줄에 맞을 때까지 줄인다. 540px 이하 화면은 하한 16 */
const HEADLINE_FIT = { max: 26, min: 18, narrowMin: 16, narrowMaxWidth: 540 };

export function CoachSummaryCard({ summary }: { summary: CoachSummary | null }) {
  const headlineRef = useRef<HTMLParagraphElement>(null);
  const { headline, rest } = splitSummary(summary?.text ?? '');
  useFitOneLine(headlineRef, headline, HEADLINE_FIT);
  if (!summary) return null;
  const badge = summaryBadge(summary.level);
  return (
    <div className="card col coach-summary">
      <div className="coach-summary-head">
        <h3>코치의 한마디</h3>
        {badge && <span className={`weak-badge tone-${badge.tone}`}>{badge.text}</span>}
        <span className="small dim">AI가 작성했어요</span>
      </div>
      <p ref={headlineRef} className="coach-summary-headline">
        {headline}
      </p>
      {rest && <p className="coach-summary-text">{rest}</p>}
    </div>
  );
}
