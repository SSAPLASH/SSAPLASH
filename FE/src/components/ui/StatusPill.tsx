// Figma Controls / StatusPill 126:1964 — 상태·난이도 표시용 알약(점 + 글자, 둘 다 variant 색). 표시 전용.
import type { HTMLAttributes } from 'react';
import './StatusPill.css';

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'ok' | 'accent' | 'neutral' | 'amber' | 'danger';
}

export function StatusPill({ variant = 'neutral', className, children, ...rest }: StatusPillProps) {
  const cls = ['ui-pill', `ui-pill-${variant}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      <span className="ui-pill-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
