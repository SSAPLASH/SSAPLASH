// Figma Controls / Button 126:1875 — 기본 버튼(primary·secondary·text·danger × md·sm).
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonStyle';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  /** React 19는 함수 컴포넌트도 ref를 props로 받는다(초점 대상 지정용) */
  ref?: Ref<HTMLButtonElement>;
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
