// Figma StepHeader 236:1287 — 단계 카드 한 장: 번호/체크 원 32, 제목 + 상태 알약, 한 줄 요약, 오른쪽 텍스트 버튼 160×44, 펼침 본문.
// 단계 판정은 하지 않는다(상태는 호출자가 정한다).
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Card } from '@/components/ui/layout/Card';
import { StatusPill } from '@/components/ui/feedback/StatusPill';
import type { SetupStepStatus } from '@/domain/kit/calibration/setupSteps';
import './setup.css';

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
  /** 연주 준비에서 돌아가려고 꼭 채워야 하는 단계(복귀 띠가 떠 있을 때). 펼쳐도 「진행 중」이 아니라 「필요」로 둔다 */
  urgent?: boolean;
  children?: ReactNode;
}

/** 화면에 보이는 상태: 필요한 단계를 펼쳐 둔 동안은 「진행 중」(복귀 중이면 「필요」 유지) */
type Shown = 'done' | 'progress' | 'needed' | 'skipped';

function shownOf(status: SetupStepStatus, expanded: boolean, urgent: boolean): Shown {
  if (status === 'needed') return expanded && !urgent ? 'progress' : 'needed';
  return status;
}

const PILL: Record<Shown, { variant: 'ok' | 'accent' | 'neutral' | 'danger'; text: string }> = {
  done: { variant: 'ok', text: '완료' },
  progress: { variant: 'accent', text: '진행 중' },
  needed: { variant: 'danger', text: '필요' },
  skipped: { variant: 'neutral', text: '필요 없음' },
};

export function StepCard({ id, index, title, status, summary, actionLabel, onAction, expanded, onCollapse, urgent = false, children }: Props) {
  const shown = shownOf(status, expanded, urgent);
  const pill = PILL[shown];
  return (
    <Card
      padding="md"
      id={id}
      role="group"
      aria-labelledby={`${id}-title`}
      className={`setup-step is-${shown}${expanded ? ' expanded' : ''}`}
    >
      <header className="setup-step-head">
        <span className="setup-step-mark" aria-hidden="true">
          {status === 'done' ? '✓' : index}
        </span>
        <div className="setup-step-main">
          <div className="setup-step-title-row">
            <h3 id={`${id}-title`} className="setup-step-title">
              {title}
            </h3>
            <StatusPill variant={pill.variant}>
              {pill.text}
            </StatusPill>
          </div>
          <p className="setup-step-summary">{summary}</p>
        </div>
        {expanded ? (
          <Button variant="text" className="setup-step-action" onClick={onCollapse}>
            접기
          </Button>
        ) : (
          actionLabel && (
            <Button variant="text" className="setup-step-action" onClick={onAction}>
              {actionLabel}
            </Button>
          )
        )}
      </header>
      {expanded && <div className="setup-step-body">{children}</div>}
    </Card>
  );
}
