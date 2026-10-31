// Figma Controls / Button 126:1875 — 버튼 모양 className 헬퍼. 링크(React Router Link 등)에 버튼 모양을 입힐 때 쓴다.
export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return ['ui-btn', `ui-btn-${variant}`, `ui-btn-${size}`, fullWidth ? 'ui-btn-full' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
}
