// Figma Controls / Button 126:1875 — 기본 버튼(primary·secondary·text·danger × md·sm).
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonStyle';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClassName({ variant, size, fullWidth, className })} {...rest}>
      {leadingIcon ? (
        <span className="ui-btn-icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
