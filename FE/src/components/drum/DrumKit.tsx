import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { FxCanvas, type FxCanvasProps } from '@/components/fx/FxCanvas';
import type { FxEngine } from '@/components/fx/fxEngine';
import type { FxSource, HitFxTheme } from '@/domain/hitFx/types';
import { createLiveFxSource } from '@/components/fx/fxSource';
import { useSettings } from '@/store/settingsStore';
import type { PadId } from '@/domain/kit/pads';
import {
  fitScale,
  fitScaleBox,
  kitBoxFor,
  kitPadsFor,
  kitSizeAt,
  placePad,
  type DrumKitPad,
  type KitSkin,
  type KitView,
  type PadBadge,
  type PadVisualState,
} from '@/domain/kit/drumKit';
import type { KitFrame } from '@/domain/kit/kitFrame';
import { Pad, PadDefs } from './Pad';
import { RING } from './padRing';
import './drum.css';

export interface DrumKitProps {
  /** 기본 1. fitWidth이면 허용 최대 scale */
  scale?: number;
  /** 부모 폭에 맞춰 최대 scale까지 줄인다 */
  fitWidth?: boolean;
  /** 부모 상자(폭·높이 모두)에 맞춰 최대 scale까지 줄이고 가운데에 둔다(contain). 부모는 높이가 정해져 있어야 한다. fitWidth보다 우선 */
  fitContain?: boolean;
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
  /**
   * 실물 스킨의 그림 종류. 기본 'persp'(원근, 큰 킷). 'top'은 위에서 본 그림(작은 킷)이라 킷 상자·배치·조각 이미지가 모두 바뀐다.
   * 전자·네온과 자유 틀(frame, 항상 원근)에서는 무시한다
   */
  view?: KitView;
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
  /** 서로 너무 가까운 패드(보정 결과 화면). --warn 테두리 링을 그린다 */
  warnPads?: PadId[];
  /** 선택한 패드(보정 결과 화면). 브랜드색 링을 그린다 */
  selectedPad?: PadId;
  /**
   * 자유 틀(드럼 세팅의 원근 보기). 주면 760×300 고정 배치 대신 틀 크기(px)에 패드를 그 자리·크기로, 목록 순서(먼 것부터)대로 그린다.
   * 하이햇 페달도 그린다. scale·fitWidth·fitContain·placement는 무시한다(domain/kit/kitFrame)
   */
  frame?: KitFrame;
  /** 실물 스킨 하이햇 닫힘(왼발 페달 밟힘 또는 페달 없음). 없으면 닫힌 채 정지해 그린다. 실시간 값은 LiveDrumKit이 넣는다 */
  hihatClosed?: boolean;
  /** 실물 스킨: 왼발 하이햇 페달이 연결되지 않음 → 페달 그림을 어둡게 */
  pedalOff?: boolean;
  /** 하이햇 페달을 밟을 때마다 바뀌는 값. 0보다 크면 바뀔 때 "칙" 모션을 재생한다 */
  pedalHitSeq?: number;
  /** SVG 뒤에 깔리는 내용(킷 크기 래퍼 .drum-kit-fx 안 첫 자식). 래퍼 기준으로 절대 배치한다 */
  underlay?: ReactNode;
  /** SVG·이펙트 캔버스 위에 덮는 내용(래퍼 안 마지막 자식). 누름을 받지 않게 쓰는 쪽 CSS가 pointer-events: none을 준다 */
  overlay?: ReactNode;
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

/** 드럼 킷(고정 배치). 렌더 크기는 스킨별 킷 상자(실물 760×487 · 전자·네온 760×300) × scale(CSS px) */
export function DrumKit({
  scale = 1,
  fitWidth = false,
  fitContain = false,
  states,
  labels = true,
  badges,
  highlight,
  onPadClick,
  onPadDown,
  skin = 'acoustic',
  view: viewProp = 'persp',
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
  warnPads,
  selectedPad,
  frame,
  hihatClosed,
  pedalOff = false,
  pedalHitSeq,
  underlay,
  overlay,
}: DrumKitProps) {
  const defsId = `kit${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);

  // 위에서 본 그림은 실물 고정 배치에서만. 자유 틀·전자·네온은 view와 무관하다
  const view: KitView = !frame && skin === 'acoustic' ? viewProp : 'persp';
  const box = kitBoxFor(skin, view);
  const fitting = !frame && (fitWidth || fitContain);
  useEffect(() => {
    if (!fitting) return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setFit(fitContain ? fitScaleBox(el.clientWidth, el.clientHeight, scale, box.h) : fitScale(el.clientWidth, scale));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitting, fitContain, scale, box.h]);

  const eff = fitting ? (fit ?? scale) : scale;
  const { width, height } = frame ? { width: frame.w, height: frame.h } : kitSizeAt(eff, skin, view);

  // 위치 덮어쓰기·숨김(보정 화면). 겹침 순서는 그대로
  const pads: readonly (DrumKitPad & { tilt?: number })[] = frame
    ? frame.pads.filter((p) => !hidden?.includes(p.pad)).map((p) => ({ ...p, h: p.w }))
    : kitPadsFor(skin, view)
        .filter((p) => !hidden?.includes(p.pad))
        .map((p) => {
          const at = placement?.[p.pad];
          return at ? placePad(p, at.x, at.y, box.h) : p;
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

  // 유령·흐림·나타남·어둡게·켬 클래스(패드 바깥 그룹과 받침 층이 같이 쓴다)
  const wrapClassOf = (pad: PadId) =>
    [
      ghost === pad ? 'drum-pad-ghost' : '',
      faded?.includes(pad) === true ? 'drum-pad-faded' : '',
      appear && ghost !== pad ? 'drum-pad-appear' : '',
      dimAll && lit !== pad ? 'drum-pad-dim' : '',
      lit === pad ? 'drum-pad-lit' : '',
    ]
      .filter(Boolean)
      .join(' ');
  // 실물 심벌(원판 조각이 있는 패드)은 받침(스탠드)이 길어 먼저 그린 가까운 패드 위로 겹친다 → 받침만 모든 패드보다 먼저 깐다
  const underPads = skin === 'acoustic' ? pads.filter((p) => p.art?.top) : [];
  const closedHihat = hihatClosed ?? true;

  const svg = (
    <svg
      className={onPadDown ? 'drum-kit touchable' : 'drum-kit'}
      data-no-pointer-strike={onPadDown ? '' : undefined}
      data-pointer-strike={onPadDown ? undefined : ''}
      viewBox={frame ? `0 0 ${frame.w} ${frame.h}` : `0 0 ${box.w} ${box.h}`}
      width={width}
      height={height}
      role="img"
      aria-label="드럼 킷"
      data-skin={skin === 'acoustic' ? undefined : skin}
    >
      <PadDefs id={defsId} />
      {withKitShake(
        <>
      {underPads.map((p) => {
        const wrapClass = wrapClassOf(p.pad);
        const under = <Pad shape={p.shape} left={p.left} top={p.top} w={p.w} label={p.label} defsId={defsId} skin={skin} art={p.art} layer="under" view={view} />;
        return wrapClass ? (
          <g key={`under-${p.pad}`} className={wrapClass}>
            {under}
          </g>
        ) : (
          <Fragment key={`under-${p.pad}`}>{under}</Fragment>
        );
      })}
      {pads.map((p) => {
        const isGhost = ghost === p.pad;
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
          tilt={p.tilt}
          art={p.art}
          view={view}
          layer={skin === 'acoustic' && p.art?.top ? 'over' : undefined}
          // 하이햇·페달만 받는다(다른 패드의 memo props는 바뀌지 않는다)
          closed={p.pad === 'HIHAT' || p.pad === 'HIHAT_PEDAL' ? closedHihat : undefined}
          pedalOff={p.pad === 'HIHAT_PEDAL' ? pedalOff : undefined}
          pedalHitSeq={p.pad === 'HIHAT' || p.pad === 'HIHAT_PEDAL' ? pedalHitSeq : undefined}
          // 고정 배치의 실물 패드는 글자 크기를 통일하고, 킷이 줄어도 약 12px 아래로 작아지지 않게 키운다(최대 1.6배,
          // 위에서 본 작은 킷은 scale이 0.3대라 2.4배까지 — 그래도 화면 글자는 약 9px).
          // 자유 틀은 헤드 크기에 비례(Pad 기본)
          textSize={frame || !p.art ? undefined : Math.min(view === 'top' ? 2.4 : 1.6, Math.max(1, eff > 0 ? 1 / eff : 1))}
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
        const wrapClass = wrapClassOf(p.pad);
        const pad0 = wrapClass ? (
          <g className={wrapClass} data-ghost={isGhost || undefined}>
            {padEl}
          </g>
        ) : (
          padEl
        );
        // 코칭 링: 패드 위에 같은 좌표계(원본 160 기준)로 그린다. 클릭을 가로채지 않는다
        const ring = p.art?.ring ?? RING[p.shape];
        const markTransform = `translate(${p.left} ${p.top}) scale(${p.w / 160})`;
        const isWarn = warnPads?.includes(p.pad) === true;
        const isSelected = selectedPad === p.pad;
        const pad =
          coachPad === p.pad || isWarn || isSelected ? (
            <>
              {pad0}
              {coachPad === p.pad && (
                <g className="drum-pad-coach" transform={markTransform} data-coach-pad={p.pad}>
                  <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} />
                </g>
              )}
              {isWarn && (
                <g className="drum-pad-warn" transform={markTransform} data-warn-pad={p.pad}>
                  <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} />
                </g>
              )}
              {isSelected && (
                <g className="drum-pad-selected" transform={markTransform} data-selected-pad={p.pad}>
                  <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx + 8} ry={ring.ry + 8} />
                </g>
              )}
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

  // 이펙트가 켜졌거나 깔개·덮개가 있는 킷은 SVG 크기에 맞춘 래퍼로 감싼다(셋 다 없으면 마크업 불변)
  const wrapped = effects || underlay != null || overlay != null;
  const body = wrapped ? (
    <div className="drum-kit-fx">
      {underlay}
      {svg}
      {effects && <FxCanvas skin={skin} view={view} theme={fxTheme ?? settingsTheme} source={fxSource} engineRef={fxEngineRef} {...fxOptions} />}
      {overlay}
    </div>
  ) : (
    svg
  );

  // fitWidth는 부모 폭을 재야 하므로 폭 100% 래퍼로 감싼다
  if (!fitting) return body;
  return (
    <div ref={wrapRef} style={fitContain ? { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' } : { width: '100%', display: 'flex', justifyContent: 'center' }}>
      {body}
    </div>
  );
}
