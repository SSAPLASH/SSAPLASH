import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import type { PadId } from '@/domain/pads';
import { DRUM_KIT_H, DRUM_KIT_W, fitScale, kitPadsFor, kitSizeAt, type KitSkin, type PadBadge, type PadVisualState } from '@/domain/drumKit';
import { HitEffects } from './HitEffects';
import { Pad, PadDefs } from './Pad';
import { usePadHitPulse } from './usePadStates';
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
  /** 패드를 누르는 즉시 부른다(터치 연주). 있으면 킷은 터치 표면이 된다: 스크롤·길게 누름·선택을 막고 포인터 모의 IMU는 이 킷을 무시한다 */
  onPadDown?: (pad: PadId, pointerType: string) => void;
  /** 드럼 모양. 기본 'acoustic'(실물) */
  skin?: KitSkin;
  /** 패드별 타격 횟수 카운터. 값이 바뀔 때마다 타격 모션을 처음부터 다시 재생한다(usePadHitSeq) */
  hitSeq?: Partial<Record<PadId, number>>;
  /** 타격 이펙트(충격파 링·심벌 스파크) 표시. 기본 false — 연주 화면에서만 켠다 */
  effects?: boolean;
}

/** 킥 진동감 기준 세기(velocity 이상이면 킷 전체가 흔들린다) */
export const KICK_SHAKE_VELOCITY = 100;

/** E4 킥 진동감: 센 킥 타격마다 자식 전체를 x 0→2→−2→1→0px, 80ms로 흔든다(연타마다 재시작). 모션 줄이기면 하지 않는다 */
function KickShake({ children }: { children: ReactNode }) {
  const pulse = usePadHitPulse();
  const reduced = useReducedMotion();
  const ref = useRef<SVGGElement>(null);
  const [count, setCount] = useState(0);
  const [seen, setSeen] = useState(pulse);
  const hit = pulse !== seen && !!pulse && !reduced && pulse.pad === 'KICK' && pulse.velocity >= KICK_SHAKE_VELOCITY;
  if (pulse !== seen) {
    setSeen(pulse);
    if (hit) setCount((c) => c + 1);
  }

  useEffect(() => {
    const el = ref.current;
    // useAnimate는 애니메이션 엔진 전체를 메인 청크에 끌어와(+41kB gzip) Web Animations로 직접 재생한다
    if (count === 0 || !el || typeof el.animate !== 'function') return;
    // 새 애니메이션이 이전 것을 덮어쓰므로(연타 재시작) 정리 단계에서 취소하지 않는다
    el.animate(
      [0, 2, -2, 1, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 80, easing: 'linear' },
    );
  }, [count]);

  return (
    <g ref={ref} className="kit-shake" data-shake={count > 0 ? count : undefined}>
      {children}
    </g>
  );
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
  onPadDown,
  skin = 'acoustic',
  hitSeq,
  effects = false,
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

  // 이펙트가 켜진 킷만 킥 진동 그룹으로 감싼다(꺼진 킷은 구조·구독 불변)
  const wrapShake = (kids: ReactNode) => (effects ? <KickShake>{kids}</KickShake> : kids);

  const svg = (
    <svg
      className={onPadDown ? 'drum-kit touchable' : 'drum-kit'}
      data-no-pointer-strike={onPadDown ? '' : undefined}
      viewBox={`0 0 ${DRUM_KIT_W} ${DRUM_KIT_H}`}
      width={width}
      height={height}
      role="img"
      aria-label="드럼 킷"
      data-skin={skin === 'acoustic' ? undefined : skin}
    >
      <PadDefs id={defsId} />
      {wrapShake(
        <>
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
          onPointerDown={
            onPadDown
              ? (e) => {
                  // 마우스는 왼쪽 버튼만. 터치·펜은 button 0
                  if (e.pointerType === 'mouse' && e.button !== 0) return;
                  e.preventDefault();
                  onPadDown(p.pad, e.pointerType);
                }
              : undefined
          }
        />
      ))}
      {/* 이펙트는 effects일 때만 마운트해 타격 구독도 하지 않는다 */}
      {effects && <HitEffects skin={skin} />}
        </>,
      )}
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
