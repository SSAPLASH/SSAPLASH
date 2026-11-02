// Figma Controls / Slider 126:1942 — 네이티브 range 입력을 감싼 슬라이더(음량·오프셋). valueText는 오른쪽 값 표시.
import { useId } from 'react';
import type { CSSProperties, InputHTMLAttributes } from 'react';
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
}

export function Slider({ label, value, min, max, step = 1, onChange, valueText, id, className, ...rest }: SliderProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={['ui-slider', className ?? ''].filter(Boolean).join(' ')}>
      <label className="ui-slider-label" htmlFor={inputId}>
        {label}
      </label>
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
      {valueText !== undefined ? <span className="ui-slider-value">{valueText}</span> : null}
    </div>
  );
}
