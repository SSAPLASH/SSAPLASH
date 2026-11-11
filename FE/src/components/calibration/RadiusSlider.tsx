// 선택 패드·보정 카드의 「판정 범위」 블록(Figma 765:33463·765:33538, UX-62 ④): 이름 왼쪽·값 오른쪽 행 → 4px 트랙 → 범위 글자.
// 값은 판정 반경(°, UX-64 D9)이라 범위는 고급 설정 하한·상한이다. 네이티브 range 입력은 공용 Slider와 같은 스타일 변수(--ui-slider-fill)를 쓴다.
import { useId, type CSSProperties } from 'react';

export interface RadiusSliderProps {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (deg: number) => void;
}

export function RadiusSlider({ value, min, max, disabled = false, onChange }: RadiusSliderProps) {
  const id = useId();
  const v = Math.round(value);
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
  return (
    <div className="setup-radius">
      <div className="setup-radius-row">
        <label htmlFor={id}>판정 범위</label>
        <span className="setup-radius-value">{v}°</span>
      </div>
      <input
        id={id}
        type="range"
        className="ui-slider-input setup-radius-input"
        min={min}
        max={max}
        step={1}
        value={v}
        disabled={disabled}
        style={{ '--ui-slider-fill': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="setup-radius-range" aria-hidden="true">
        <span>{min}°</span>
        <span>{max}°</span>
      </div>
    </div>
  );
}
