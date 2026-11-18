// Figma Controls / Slider 126:1942 — 네이티브 range 입력을 감싼 슬라이더(음량·오프셋). 세로 배치(라벨 → 값 → 트랙). valueText가 없으면 값 줄이 없다.
import { useId } from 'react';
import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import './Slider.css';

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max' | 'step' | 'onChange'> {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  valueText?: string;
  /** 트랙 왼쪽 장식(선택). leading·trailing 중 하나라도 있으면 입력을 한 줄 묶음으로 감싼다 */
  leading?: ReactNode;
  /** 트랙 오른쪽 장식(선택) */
  trailing?: ReactNode;
}

export function Slider({ label, value, min, max, step = 1, onChange, valueText, leading, trailing, id, className, ...rest }: SliderProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const input = (
    <input
      {...rest}
      id={inputId}
      type="range"
      className="ui-slider-input"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--ui-slider-fill': `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
  return (
    <div className={['ui-slider', className ?? ''].filter(Boolean).join(' ')}>
      <label className="ui-slider-label" htmlFor={inputId}>
        {label}
      </label>
      {valueText !== undefined ? <span className="ui-slider-value">{valueText}</span> : null}
      {leading || trailing ? (
        <div className="ui-slider-track-row">
          {leading}
          {input}
          {trailing}
        </div>
      ) : (
        input
      )}
    </div>
  );
}
