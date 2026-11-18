// Figma Controls / Input 126:1927 — 라벨·도움말·오류·글자 수 카운터가 있는 텍스트 입력.
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import './Input.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  help?: string;
  error?: string;
  counter?: { value: number; max: number };
  /** 검색칸처럼 입력 필드만 보이는 형태: 라벨은 시각적으로만 숨기고(접근성용으로 남김) 도움말·카운터·오류 줄을 그리지 않는다 */
  compact?: boolean;
  /** 입력칸 안 오른쪽에 붙는 요소(예: 검색어 지우기 ×). undefined면 기존 모양 그대로.
   *  null이면 요소 없이 자리(오른쪽 여백)만 둔다 — 요소가 생기고 사라져도 input이 다시 만들어지지 않는다 */
  trailing?: ReactNode;
  /** React 19는 함수 컴포넌트도 ref를 props로 받는다(초점 대상 지정용) */
  ref?: Ref<HTMLInputElement>;
}

export function Input({ label, help, error, counter, compact = false, trailing, id, className, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  // 도움말과 오류는 함께 보인다(Figma Controls / Input error: 도움말 줄 + 오류 줄)
  const showHelp = !compact && Boolean(help);
  const showError = !compact && Boolean(error);
  const describedBy = [showHelp ? helpId : '', showError ? errorId : '', rest['aria-describedby'] ?? '']
    .filter(Boolean)
    .join(' ');
  const field = (
    <input
      {...rest}
      id={inputId}
      className="ui-input-field"
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
    />
  );
  return (
    <div className={['ui-input', compact ? 'compact' : '', trailing !== undefined ? 'has-trailing' : '', error ? 'error' : '', className ?? ''].filter(Boolean).join(' ')}>
      <label className={compact ? 'ui-input-label ui-input-label-hidden' : 'ui-input-label'} htmlFor={inputId}>
        {label}
      </label>
      {trailing !== undefined ? (
        <div className="ui-input-control">
          {field}
          {trailing ? <span className="ui-input-trailing">{trailing}</span> : null}
        </div>
      ) : (
        field
      )}
      {compact ? null : (
        <div className="ui-input-foot">
          {help ? (
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
      )}
      {showError ? (
        <span id={errorId} className="ui-input-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
