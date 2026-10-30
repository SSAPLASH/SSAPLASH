import { useEffect, useId, useRef, useState } from 'react';
import type { PadId } from '@/domain/pads';
import { DRUM_KIT_H, DRUM_KIT_PADS, DRUM_KIT_W, fitScale, kitSizeAt, type PadVisualState } from '@/domain/drumKit';
import { Pad, PadDefs } from './Pad';
import './drum.css';

export interface DrumKitProps {
  /** 기본 1. fitWidth이면 허용 최대 scale */
  scale?: number;
  /** 부모 폭에 맞춰 최대 scale까지 줄인다 */
  fitWidth?: boolean;
  states?: Partial<Record<PadId, PadVisualState>>;
  labels?: boolean;
  badges?: Partial<Record<PadId, string>>;
  /** 배지를 강조할 패드 */
  highlight?: PadId;
  onPadClick?: (pad: PadId) => void;
}

/** 드럼 킷(고정 배치 8패드). 렌더 크기는 760×300 × scale(CSS px) */
export function DrumKit({
  scale = 1,
  fitWidth = false,
  states,
  labels = true,
  badges,
  highlight,
  onPadClick,
}: DrumKitProps) {
  const defsId = `kit${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);

  useEffect(() => {
    if (!fitWidth) return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setFit(fitScale(el.clientWidth, scale));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitWidth, scale]);

  const eff = fitWidth ? (fit ?? scale) : scale;
  const { width, height } = kitSizeAt(eff);

  const svg = (
    <svg
      className="drum-kit"
      viewBox={`0 0 ${DRUM_KIT_W} ${DRUM_KIT_H}`}
      width={width}
      height={height}
      role="img"
      aria-label="드럼 킷"
    >
      <PadDefs id={defsId} />
      {DRUM_KIT_PADS.map((p) => (
        <Pad
          key={p.pad}
          shape={p.shape}
          left={p.left}
          top={p.top}
          w={p.w}
          label={p.label}
          labelVisible={labels}
          state={states?.[p.pad] ?? 'idle'}
          badge={badges?.[p.pad]}
          badgeHighlight={highlight === p.pad}
          defsId={defsId}
          onClick={onPadClick ? () => onPadClick(p.pad) : undefined}
        />
      ))}
    </svg>
  );

  // fitWidth는 부모 폭을 재야 하므로 폭 100% 래퍼로 감싼다
  if (!fitWidth) return svg;
  return (
    <div ref={wrapRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      {svg}
    </div>
  );
}
