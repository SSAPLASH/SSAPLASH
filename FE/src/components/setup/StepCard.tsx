// 단계 카드 한 장: 번호/체크 원, 제목, 상태 배지, 요약, 오른쪽 동작 버튼, 펼침 본문. 단계 판정은 하지 않는다.
import type { ReactNode } from 'react';
import type { SetupStepStatus } from '@/domain/setupSteps';

interface Props {
  /** 페이지가 scrollIntoView로 찾을 DOM id */
  id: string;
  index: number;
  title: string;
  status: SetupStepStatus;
  summary: string;
  /** 오른쪽 동작 버튼 문구(없으면 버튼 없음). 펼친 동안엔 [접기]가 대신 보인다 */
  actionLabel?: string;
  onAction?: () => void;
  expanded: boolean;
  onCollapse: () => void;
  children?: ReactNode;
}

const BADGE: Record<SetupStepStatus, string> = { needed: '필요', done: '완료', skipped: '필요 없음' };

export function StepCard({ id, index, title, status, summary, actionLabel, onAction, expanded, onCollapse, children }: Props) {
  return (
    <section id={id} className={`card step-card ${status}${expanded ? ' expanded' : ''}`} aria-labelledby={`${id}-title`}>
      <header className="step-head">
        <span className="step-mark" aria-hidden="true">
          {status === 'done' ? '✓' : index}
        </span>
        <div className="step-main">
          <div className="step-title-row">
            <h3 id={`${id}-title`}>{title}</h3>
            <span className={`step-badge ${status}`}>{BADGE[status]}</span>
          </div>
          <p className="step-summary small faint">{summary}</p>
        </div>
        {expanded ? (
          <button type="button" className="btn-ghost small" onClick={onCollapse}>
            접기
          </button>
        ) : (
          actionLabel && (
            <button type="button" className="btn-ghost small" onClick={onAction}>
              {actionLabel}
            </button>
          )
        )}
      </header>
      {expanded && <div className="step-body">{children}</div>}
    </section>
  );
}
