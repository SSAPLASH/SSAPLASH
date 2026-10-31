// Figma Controls / Card 126:1955 — 표면 카드. clickable이면 hover로 떠오른다(클릭 처리는 호출부 onClick).
import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  padding?: 'md' | 'lg';
  clickable?: boolean;
  title?: ReactNode;
}

export function Card({ padding = 'md', clickable = false, title, className, children, ...rest }: CardProps) {
  const cls = ['ui-card', `ui-card-${padding}`, clickable ? 'ui-card-clickable motion-lift' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...rest}>
      {title ? <h3 className="ui-card-title">{title}</h3> : null}
      {children}
    </div>
  );
}
