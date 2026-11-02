// Figma Controls / IconButton 126:1894 — 아이콘만 있는 정사각 버튼. label은 aria-label·title.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './IconButton.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  size?: 'md' | 'sm';
  label: string;
  active?: boolean;
  children: ReactNode;
}

export function IconButton({
  size = 'md',
  label,
  active = false,
  className,
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  const cls = ['ui-icon-btn', `ui-icon-btn-${size}`, active ? 'active' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
