// Figma Controls / Toggle 126:1936 — 52×28 스위치. role="switch", 클릭·Space·Enter로 전환(네이티브 button).
import type { ButtonHTMLAttributes } from 'react';
import './Toggle.css';

export interface ToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'aria-checked'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function Toggle({ checked, onChange, label, disabled, className, type = 'button', ...rest }: ToggleProps) {
  const cls = ['ui-toggle', checked ? 'on' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cls}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="ui-toggle-knob" aria-hidden="true" />
    </button>
  );
}
