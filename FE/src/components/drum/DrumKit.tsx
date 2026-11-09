import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { FxCanvas, type FxCanvasProps } from '@/components/fx/FxCanvas';
import type { FxEngine } from '@/components/fx/fxEngine';
import type { FxSource, HitFxTheme } from '@/domain/hitFx/types';
import { createLiveFxSource } from '@/components/fx/fxSource';
import { useSettings } from '@/store/settingsStore';
import type { PadId } from '@/domain/pads';
import {
  DRUM_KIT_H,
  DRUM_KIT_W,
  fitScale,
  kitPadsFor,
  kitSizeAt,
  placePad,
  type DrumKitPad,
  type KitSkin,
  type PadBadge,
  type PadVisualState,
} from '@/domain/drumKit';
import { Pad, PadDefs } from './Pad';
import { RING } from './padRing';
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
  /** 타격 이펙트(테마 캔버스) 표시. 기본 false — 연주 화면에서만 켠다 */
  effects?: boolean;
  /** 이펙트 테마. 없으면 설정(hitFxTheme)을 쓴다. 랩·미리보기가 덮어쓸 때 넘긴다 */
  fxTheme?: HitFxTheme;
  /** 이펙트 이벤트 소스. 없으면 liveStore(실제 타격)를 구독한다. 있으면 패드 흔들림도 실제 타격에 반응하지 않는다 */
  fxSource?: FxSource;
  /** 랩 전용: 엔진을 바깥으로 내보낸다(통계 표시) */
  fxEngineRef?: { current: FxEngine | null };
  /** 랩 전용: 모션 줄이기 강제·파티클 상한·발광 */
  fxOptions?: Pick<FxCanvasProps, 'reduced' | 'maxParticles' | 'glow'>;
  /** 패드 헤드 중심을 정규화 좌표(0~1)로 덮어쓴다(보정 화면: 실제 친 위치). 없는 패드는 고정 배치 */
  placement?: Partial<Record<PadId, { x: number; y: number }>>;
  /** 그리지 않을 패드(보정 화면: 아직 안 잡은 패드) */
  hidden?: PadId[];
  /** 유령(반투명 + 링 깜빡임)으로 그릴 목표 패드 */
  ghost?: PadId;
  /** 흐리게 그릴 패드(보정 대상이 아닌 페달 패드) */
  faded?: PadId[];
  /** 패드가 새로 나타날 때 0.2s 확대 모션(보정 화면). 동작 줄이기면 즉시 */
  appear?: boolean;
  /** 킷 전체를 어둡게(0.18). lit 패드만 제외(UX-64 보정 무대) */
  dimAll?: boolean;
  /** 원래 밝기 + 브랜드색 글로우로 켤 패드(지금 칠 패드) */
  lit?: PadId;
  /** 실시간 코칭이 가리키는 패드. 그 패드에 링을 그린다(문구가 떠 있는 동안만 넘긴다). ghost·lit와 별개 */
  coachPad?: PadId;
}

/** 이 세기 이상으로 친 드럼 계열 패드만 흔든다(E4) */
export const PAD_SHAKE_VELOCITY = 100;

/**
 * 진동 횟수(E4). 킥은 몸으로 느끼는 저음이라 킷 전체를, 스네어·탐은 친 패드만 흔든다(어디를 쳤는지가 분명하게).
 * 심벌은 이미 회전 흔들림이 있어 제외한다. enabled가 아니거나 동작 줄이기면 세지 않는다
 */
function usePadShakeCounts(enabled: boolean, source: FxSource, shapeOf: (pad: PadId) => string | undefined) {
  const reduced = useReducedMotion();
  const [counts, setCounts] = useState<Partial<Record<PadId, number>>>({});
  // 타격마다 DrumKit이 다시 렌더되지 않게, 이펙트 소스를 직접 구독하고 흔들 때만 state를 바꾼다
  const shapeRef = useRef(shapeOf);
  useEffect(() => {
    shapeRef.current = shapeOf;
  });
  useEffect(() => {
    if (!enabled || reduced) return;
    return source((e) => {
      if (e.velocity < PAD_SHAKE_VELOCITY || shapeRef.current(e.pad) === 'cymbal') return;
      setCounts((c) => ({ ...c, [e.pad]: (c[e.pad] ?? 0) + 1 }));
    });
  }, [enabled, reduced, source]);
  return counts;
}

/** 실제 연주 흔들림 소스(모듈 공용 — 구독마다 새로 만들 필요가 없다) */
const LIVE_SHAKE_SOURCE = createLiveFxSource('free');

/** 감싼 내용(패드 하나 또는 킷 전체)을 count가 오를 때마다 좌우로 80ms 흔든다 */
function Shake({ count, className, children }: { count: number | undefined; className: string; children: ReactNode }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = ref.current;
    // useAnimate는 애니메이션 엔진 전체를 메인 청크에 끌어와(+41kB gzip) Web Animations로 직접 재생한다
    if (!count || !el || typeof el.animate !== 'function') return;
    // 새 애니메이션이 이전 것을 덮어쓰므로(연타 재시작) 정리 단계에서 취소하지 않는다
    el.animate(
      [0, 2, -2, 1, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 80, easing: 'linear' },
    );
  }, [count]);
  return (
    <g ref={ref} className={className} data-shake={count || undefined}>
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
  fxTheme,
  fxSource,
  fxEngineRef,
  fxOptions,
  placement,
  hidden,
  ghost,
  faded,
  appear = false,
  dimAll = false,
  lit,
  coachPad,
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

  // 위치 덮어쓰기·숨김(보정 화면). 겹침 순서는 그대로
  const pads: readonly DrumKitPad[] = kitPadsFor(skin)
    .filter((p) => !hidden?.includes(p.pad))
    .map((p) => {
      const at = placement?.[p.pad];
      return at ? placePad(p, at.x, at.y) : p;
    });
  const settingsTheme = useSettings((st) => st.hitFxTheme);
  const shakes = usePadShakeCounts(effects, fxSource ?? LIVE_SHAKE_SOURCE, (pad) => pads.find((p) => p.pad === pad)?.shape);
  // 킥 진동은 킷 전체(캔버스 이펙트는 SVG 밖이라 흔들리지 않는다)를 흔든다. 이펙트가 꺼진 킷은 감싸지 않는다
  const withKitShake = (kids: ReactNode) =>
    effects ? (
      <Shake className="kit-shake" count={shakes.KICK}>
        {kids}
      </Shake>
    ) : (
      kids
    );

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
      {withKitShake(
        <>
      {pads.map((p) => {
        const isGhost = ghost === p.pad;
        const isFaded = faded?.includes(p.pad) === true;
        const padEl = (
        <Pad
          key={p.pad}
          shape={p.shape}
          left={p.left}
          top={p.top}
          w={p.w}
          label={p.label}
          labelVisible={labels}
          state={isGhost ? 'armed' : (states?.[p.pad] ?? 'idle')}
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
        );
        // 유령·흐림·나타남은 패드 바깥 그룹에 건다(Pad 마크업 불변)
        const isLit = lit === p.pad;
        const wrapClass = [
          isGhost ? 'drum-pad-ghost' : '',
          isFaded ? 'drum-pad-faded' : '',
          appear && !isGhost ? 'drum-pad-appear' : '',
          dimAll && !isLit ? 'drum-pad-dim' : '',
          isLit ? 'drum-pad-lit' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const pad0 = wrapClass ? (
          <g className={wrapClass} data-ghost={isGhost || undefined}>
            {padEl}
          </g>
        ) : (
          padEl
        );
        // 코칭 링: 패드 위에 같은 좌표계(원본 160 기준)로 그린다. 클릭을 가로채지 않는다
        const ring = RING[p.shape];
        const pad =
          coachPad === p.pad ? (
            <>
              {pad0}
              <g className="drum-pad-coach" transform={`translate(${p.left} ${p.top}) scale(${p.w / 160})`} data-coach-pad={p.pad}>
                <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} />
              </g>
            </>
          ) : (
            pad0
          );
        // 이펙트가 켜진 킷만 패드별 진동 그룹으로 감싼다(꺼진 킷은 마크업 불변). 킥은 킷 전체 그룹이 흔든다
        return effects ? (
          <Shake key={p.pad} className="pad-shake" count={p.pad === 'KICK' ? undefined : shakes[p.pad]}>
            {pad}
          </Shake>
        ) : (
          <Fragment key={p.pad}>{pad}</Fragment>
        );
      })}
        </>,
      )}
    </svg>
  );

  // 이펙트가 켜진 킷은 SVG 크기에 맞춘 래퍼에 캔버스를 겹친다(꺼진 킷은 마크업 불변)
  const body = effects ? (
    <div className="drum-kit-fx">
      {svg}
      <FxCanvas skin={skin} theme={fxTheme ?? settingsTheme} source={fxSource} engineRef={fxEngineRef} {...fxOptions} />
    </div>
  ) : (
    svg
  );

  // fitWidth는 부모 폭을 재야 하므로 폭 100% 래퍼로 감싼다
  if (!fitWidth) return body;
  return (
    <div ref={wrapRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      {body}
    </div>
  );
}
