// Figma Feedback / EmptyState 126:3830 — 빈 목록·빈 화면 안내. action은 보통 Button.
// 오류 안내는 ErrorState(패널)·InlineError(알림 줄)를 쓴다.
import type { HTMLAttributes, ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** 제목 단계. 화면에 다른 제목이 없으면 2, 구역 안이면 3(기본) */
  headingLevel?: 2 | 3;
  /** sm은 필터 결과 없음 같은 작은 자리용: 제목 14px·여백 16, 아이콘을 그리지 않는다 */
  size?: 'md' | 'sm';
}

export function EmptyState({ icon, title, description, action, headingLevel = 3, size = 'md', className, ...rest }: EmptyStateProps) {
  const cls = ['ui-empty', size === 'sm' ? 'ui-empty-sm' : '', className ?? ''].filter(Boolean).join(' ');
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cls} {...rest}>
      {icon && size !== 'sm' ? (
        <div className="ui-empty-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <Heading className="ui-empty-title">{title}</Heading>
      {description ? <p className="ui-empty-desc">{description}</p> : null}
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  );
}
