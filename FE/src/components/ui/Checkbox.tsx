// Figma Controls / Checkbox 440:19724 — 20×20 체크박스. 네이티브 input + label이라 라벨 클릭·Space·스크린리더가 기본으로 동작한다.
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import './Checkbox.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 옆 라벨. 클릭 영역에 포함된다 */
  label: ReactNode;
  /** 라벨 글자 크기 — Figma에서 라벨은 Controls / Text 인스턴스라 자리마다 다르다 */
  labelStyle?: 'body-14' | 'body-16';
}

export function Checkbox({ checked, onChange, label, labelStyle = 'body-14', id, className, disabled, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const cls = ['ui-checkbox', disabled ? 'ui-checkbox-disabled' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <label className={cls} htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        className="ui-checkbox-input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span className="ui-checkbox-box" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" />
        </svg>
      </span>
      <span className={`ui-checkbox-label t-${labelStyle}`}>{label}</span>
    </label>
  );
}
