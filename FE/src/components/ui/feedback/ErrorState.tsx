// 패널형 오류 안내 — 구역에 보여 줄 다른 내용이 하나도 없을 때 쓴다. 틀은 EmptyState와 같고(Figma Feedback / EmptyState 126:3830)
// 오류 표시 아이콘·작은 제목·작은 보조 버튼으로 조금 더 촘촘하게 그린다. 다른 내용 옆에 붙는 오류는 InlineError를 쓴다.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/action/Button';
import './EmptyState.css';
import './ErrorState.css';

export interface ErrorStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** 있으면 [다시 시도] 버튼을 그린다 */
  onRetry?: () => void;
  retryLabel?: string;
  /** onRetry 대신 넣는 버튼(예: [라이브러리로]) */
  action?: ReactNode;
  /** 제목 단계. 화면에 다른 제목이 없으면 2, 구역 안이면 3(기본) */
  headingLevel?: 2 | 3;
  /** lg는 화면·탭 본문 가운데에 혼자 뜨는 자리용: 여백·글자·버튼이 함께 커진다 */
  size?: 'md' | 'lg';
  className?: string;
}

function AlertIcon() {
  return (
    <span className="ui-error-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M8 3.4v5.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.9" r="1.1" fill="currentColor" />
      </svg>
    </span>
  );
}

export function ErrorState({ title, description, onRetry, retryLabel = '다시 시도', action, headingLevel = 3, size = 'md', className }: ErrorStateProps) {
  const cls = ['ui-empty', 'ui-error', size === 'lg' ? 'ui-error-lg' : '', className ?? ''].filter(Boolean).join(' ');
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const buttons =
    action ??
    (onRetry ? (
      <Button variant="secondary" size={size === 'lg' ? 'md' : 'sm'} onClick={onRetry}>
        {retryLabel}
      </Button>
    ) : null);
  return (
    <div className={cls} role="alert">
      <AlertIcon />
      <Heading className="ui-empty-title">{title}</Heading>
      {description ? <p className="ui-empty-desc">{description}</p> : null}
      {buttons ? <div className="ui-empty-action">{buttons}</div> : null}
    </div>
  );
}
