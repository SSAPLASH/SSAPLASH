// Figma Feedback / FeedbackCard 126:3809 — 아이콘 20 + 제목 14 + 설명 12 가로 카드. 마디 범위가 있고 onFocusBars가 있으면 버튼으로 그려 약점 마디 미니 악보를 바꾼다.
import type { FeedbackItem } from '@/features/result/domain/feedback';
import './result.css';

export interface FeedbackCardProps {
  item: FeedbackItem;
  /** 마디 범위가 있는 카드를 눌렀을 때 */
  onFocusBars?: (bars: [number, number]) => void;
  /** 지금 미니 악보에 보이는 카드인지 */
  active?: boolean;
}

/** Icons / 기록 — 20px 선 아이콘 */
function RecordIcon() {
  return (
    <svg
      className="result-fb-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export function FeedbackCard({ item, onFocusBars, active = false }: FeedbackCardProps) {
  const bars = item.bars;
  const body = (
    <>
      <RecordIcon />
      <span className="result-fb-content">
        <span className="result-fb-title">{item.title}</span>
        <span className="result-fb-desc">{item.body}</span>
        {item.suggestion ? <span className="result-fb-desc">{item.suggestion}</span> : null}
      </span>
    </>
  );
  if (bars && onFocusBars) {
    return (
      <button
        type="button"
        className={active ? 'result-fb result-fb-click active' : 'result-fb result-fb-click'}
        onClick={() => onFocusBars(bars)}
        aria-pressed={active}
      >
        {body}
      </button>
    );
  }
  return <div className="result-fb">{body}</div>;
}
