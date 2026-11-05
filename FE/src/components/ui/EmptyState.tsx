// Figma Feedback / EmptyState 126:3830 — 빈 목록·빈 화면 안내. action은 보통 Button.
import type { HTMLAttributes, ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action, className, ...rest }: EmptyStateProps) {
  const cls = ['ui-empty', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} {...rest}>
      {icon ? (
        <div className="ui-empty-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="ui-empty-title">{title}</h3>
      {description ? <p className="ui-empty-desc">{description}</p> : null}
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  );
}
