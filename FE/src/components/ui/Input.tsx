// Figma Controls / Input 126:1927 — 라벨·도움말·오류·글자 수 카운터가 있는 텍스트 입력.
import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import './Input.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  help?: string;
  error?: string;
  counter?: { value: number; max: number };
}

export function Input({ label, help, error, counter, id, className, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = [error ? errorId : help ? helpId : '', rest['aria-describedby'] ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={['ui-input', error ? 'error' : '', className ?? ''].filter(Boolean).join(' ')}>
      <label className="ui-input-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        className="ui-input-field"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      <div className="ui-input-foot">
        {error ? (
          <span id={errorId} className="ui-input-error" role="alert">
            {error}
          </span>
        ) : help ? (
          <span id={helpId} className="ui-input-help">
            {help}
          </span>
        ) : (
          <span />
        )}
        {counter ? (
          <span className="ui-input-counter">
            {counter.value}/{counter.max}
          </span>
        ) : null}
      </div>
    </div>
  );
}
