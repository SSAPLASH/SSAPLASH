// Figma Studio / ViewToggle 203:682 — 세그먼트 선택(보기 전환·탭·필터). role="radiogroup", 좌우 화살표 이동.
import type { KeyboardEvent, ReactNode } from 'react';
import './Segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, label, className }: SegmentedProps<T>) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let step = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step = -1;
    if (step === 0 || options.length === 0) return;
    e.preventDefault();
    const cur = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
    const nextIndex = (cur + step + options.length) % options.length;
    onChange(options[nextIndex].value);
    // 새로 선택된 항목으로 포커스를 옮긴다(roving tabindex)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={['ui-seg', className ?? ''].filter(Boolean).join(' ')}
      onKeyDown={handleKeyDown}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'ui-seg-item selected' : 'ui-seg-item'}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
