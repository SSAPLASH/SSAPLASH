import { useEffect, useId, useRef, useState } from 'react';
import type { PadId } from '@/domain/pads';
import { DRUM_KIT_H, DRUM_KIT_W, fitScale, kitPadsFor, kitSizeAt, type KitSkin, type PadBadge, type PadVisualState } from '@/domain/drumKit';
import { Pad, PadDefs } from './Pad';
import './drum.css';

export interface DrumKitProps {
  /** 기본 1. fitWidth이면 허용 최대 scale */
  scale?: number;
  /** 부모 폭에 맞춰 최대 scale까지 줄인다 */
  fitWidth?: boolean;
  states?: Partial<Record<PadId, PadVisualState>>;
  labels?: boolean;
  /** 문자열은 next 배지. PadBadge로 now·later·격자 밖 점을 지정한다(now 배지는 여러 개여도 각자 강조) */
  badges?: Partial<Record<PadId, string | PadBadge>>;
  /** 배지를 강조할 패드(PadBadge level now와 같은 모양) */
  highlight?: PadId;
  onPadClick?: (pad: PadId) => void;
  /** 드럼 모양. 기본 'acoustic'(실물) */
  skin?: KitSkin;
  /** 패드별 타격 횟수 카운터. 값이 바뀔 때마다 타격 모션을 처음부터 다시 재생한다(usePadHitSeq) */
  hitSeq?: Partial<Record<PadId, number>>;
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
  skin = 'acoustic',
  hitSeq,
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
      data-skin={skin === 'acoustic' ? undefined : skin}
    >
      <PadDefs id={defsId} />
      {kitPadsFor(skin).map((p) => (
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
          skin={skin}
          tag={p.tag}
          hitKey={hitSeq?.[p.pad]}
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
