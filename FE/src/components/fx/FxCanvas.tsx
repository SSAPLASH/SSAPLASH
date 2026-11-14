// 타격 이펙트 캔버스 — DrumKit SVG 위에 절대 위치로 겹친다. 이벤트는 source에서 직접 받아 엔진에 넣고(React state 없음),
// 테마·스킨·모션 줄이기만 속성으로 받아 엔진 설정을 바꾼다. 포인터 이벤트는 받지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { DRUM_KIT_W, kitBoxFor, type KitSkin, type KitView } from '@/domain/kit/drumKit';
import { hitFxThemeDef } from '@/domain/hitFx/themes';
import type { FxLocate, FxMode, FxSource, HitFxTheme } from '@/domain/hitFx/types';
import { MAX_PARTICLES, createFxEngine, type FxEngine } from './fxEngine';
import type { FxView } from './fxDraw';
import { createLiveFxSource } from './fxSource';
import { readJudgeColors } from './judgeColors';

/** 킷 바깥으로 이펙트가 넘칠 기본 여백(킷 크기의 비율, 사방) */
export const DEFAULT_BLEED = 0.12;
/** 화면 배율 상한(D8) */
const MAX_DPR = 2;

export interface FxCanvasProps {
  /** 킷 좌표 공간(기본)에서 패드 위치·테마를 찾는 데 쓴다. 픽셀 공간에서는 쓰지 않는다 */
  skin?: KitSkin;
  /** 실물 스킨의 그림 종류(킷 상자 높이·패드 자리가 다르다). 기본 persp */
  view?: KitView;
  theme?: HitFxTheme;
  /**
   * 좌표 공간. 'kit'(기본) = 킷 좌표 760×300을 부모 폭에 맞춰 늘리고 여백(bleed)을 둔다 / 'pixel' = 부모 크기 그대로 CSS 픽셀
   * (하이웨이·악보 위에 겹친다. 부모는 position이 static이 아니어야 한다)
   */
  space?: 'kit' | 'pixel';
  /** 이벤트 → 위치·모양. 없으면 킷 좌표의 패드 헤드. 픽셀 공간은 source와 함께 반드시 넘긴다 */
  locate?: FxLocate;
  /** 없으면 liveStore(실제 타격)를 구독한다 */
  source?: FxSource;
  mode?: FxMode;
  bleed?: number;
  /** 킷 좌표 공간에서 위쪽 여백(킷 높이 비율). 없으면 테마 정의 값. 좌우·아래는 bleed */
  bleedTop?: number;
  /** 엔진을 바깥에서 쓰고 싶을 때(랩의 통계 표시). 없으면 안에서 만든다 */
  engineRef?: { current: FxEngine | null };
  /** 모션 줄이기 강제(랩). 없으면 OS 설정을 따른다 */
  reduced?: boolean;
  /** 전체 파티클 상한(랩 스파이크). 없으면 엔진 기본 */
  maxParticles?: number;
  /** 발광 사용 여부(랩 비교). 기본 true */
  glow?: boolean;
}

export function FxCanvas({ skin = 'acoustic', view = 'persp', theme = 'auto', space = 'kit', locate, source, mode = 'free', bleed = DEFAULT_BLEED, bleedTop: bleedTopProp, engineRef, reduced: reducedProp, maxParticles, glow = true }: FxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine] = useState(() => createFxEngine());
  const osReduced = useReducedMotion() ?? false;
  const reduced = reducedProp ?? osReduced;
  const liveSource = useMemo(() => createLiveFxSource(mode), [mode]);
  const src = source ?? liveSource;
  // locate는 렌더마다 새 함수일 수 있어 ref로 최신 값만 본다(엔진·구독을 다시 만들지 않는다)
  const locateRef = useRef(locate);
  useEffect(() => {
    locateRef.current = locate;
  });
  const hasLocate = locate !== undefined;

  useEffect(() => {
    if (engineRef) engineRef.current = engine;
    return () => {
      if (engineRef) engineRef.current = null;
    };
  }, [engine, engineRef]);

  // 설정은 구독보다 먼저 반영한다(같은 커밋 안의 effect는 선언 순서대로 돈다)
  useEffect(() => {
    engine.setTheme(theme);
    engine.setSkin(skin, view);
    engine.setReduced(reduced);
  }, [engine, theme, skin, view, reduced]);

  useEffect(() => {
    engine.setLocate(hasLocate ? (e) => locateRef.current?.(e) ?? null : null);
  }, [engine, hasLocate]);

  useEffect(() => {
    engine.setMaxParticles(maxParticles ?? MAX_PARTICLES);
    engine.setGlow(glow);
  }, [engine, maxParticles, glow]);

  // 캔버스 크기·좌표: 부모(킷 래퍼)의 실제 렌더 크기 + bleed 여백
  const boxH = kitBoxFor(skin, view).h;
  const bleedTop = bleedTopProp ?? hitFxThemeDef(theme).bleedTop;
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    // 캔버스는 CSS 변수를 못 쓰므로 brand 색을 한 번 읽어 둔다
    const brand = getComputedStyle(canvas).getPropertyValue('--brand').trim();
    if (brand) engine.setBrand(brand);
    engine.setJudgeColors(readJudgeColors(canvas));

    let attached = false;
    const update = () => {
      const w = host.clientWidth;
      if (!(w > 0)) return;
      const pixel = space === 'pixel';
      const scale = pixel ? 1 : w / DRUM_KIT_W;
      const h = pixel ? host.clientHeight : boxH * scale;
      if (!(h > 0)) return;
      const bx = pixel ? 0 : Math.round(w * bleed);
      const by = pixel ? 0 : Math.round(h * bleed);
      // 위쪽 여백만 테마(또는 prop)가 따로 정한다. 그림이 헤드 위로 솟기 때문이다
      const top = pixel ? 0 : Math.round(h * bleedTop);
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const view: FxView = { width: w + bx * 2, height: h + top + by, scale, offsetX: bx, offsetY: top, dpr };
      canvas.style.left = `${-bx}px`;
      canvas.style.top = `${-top}px`;
      canvas.style.width = `${view.width}px`;
      canvas.style.height = `${view.height}px`;
      const pw = Math.round(view.width * dpr);
      const ph = Math.round(view.height * dpr);
      // 크기가 같을 때 width를 다시 쓰면 캔버스가 지워지고 비용이 든다
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      if (attached) engine.setView(view);
      else {
        engine.attach(canvas, view);
        attached = true;
      }
    };
    update();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(host);
    return () => {
      ro?.disconnect();
      engine.detach();
    };
  }, [engine, bleed, bleedTop, space, boxH]);

  // 이벤트 구독: 타격마다 React를 거치지 않고 엔진으로 간다
  useEffect(() => src((e) => engine.emit(e)), [engine, src]);

  return <canvas ref={canvasRef} className="fx-canvas" aria-hidden="true" data-fx-theme={theme} />;
}
