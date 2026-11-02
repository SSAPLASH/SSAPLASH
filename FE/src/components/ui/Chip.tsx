// Figma Controls / Chip 126:1941 — 필터 칩(난이도·모드 필터). 토글 버튼이라 aria-pressed를 쓴다.
import type { ButtonHTMLAttributes } from 'react';
import './Chip.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ selected = false, className, type = 'button', children, ...rest }: ChipProps) {
  const cls = ['ui-chip', selected ? 'selected' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} aria-pressed={selected} {...rest}>
      {children}
    </button>
  );
}
