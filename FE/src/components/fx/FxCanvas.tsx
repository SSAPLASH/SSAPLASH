// 타격 이펙트 캔버스 — DrumKit SVG 위에 절대 위치로 겹친다. 이벤트는 source에서 직접 받아 엔진에 넣고(React state 없음),
// 테마·스킨·모션 줄이기만 속성으로 받아 엔진 설정을 바꾼다. 포인터 이벤트는 받지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { DRUM_KIT_H, DRUM_KIT_W, type KitSkin } from '@/domain/drumKit';
import type { FxMode, FxSource, HitFxTheme } from '@/domain/hitFx/types';
import { MAX_PARTICLES, createFxEngine, type FxEngine } from './fxEngine';
import type { FxView } from './fxDraw';
import { createLiveFxSource } from './fxSource';

/** 킷 바깥으로 이펙트가 넘칠 기본 여백(킷 크기의 비율, 사방) */
export const DEFAULT_BLEED = 0.12;
/** 화면 배율 상한(D8) */
const MAX_DPR = 2;

export interface FxCanvasProps {
  skin: KitSkin;
  theme: HitFxTheme;
  /** 없으면 liveStore(실제 타격)를 구독한다 */
  source?: FxSource;
  mode?: FxMode;
  bleed?: number;
  /** 엔진을 바깥에서 쓰고 싶을 때(랩의 통계 표시). 없으면 안에서 만든다 */
  engineRef?: { current: FxEngine | null };
  /** 모션 줄이기 강제(랩). 없으면 OS 설정을 따른다 */
  reduced?: boolean;
  /** 전체 파티클 상한(랩 스파이크). 없으면 엔진 기본 */
  maxParticles?: number;
  /** 발광 사용 여부(랩 비교). 기본 true */
  glow?: boolean;
}

export function FxCanvas({ skin, theme, source, mode = 'free', bleed = DEFAULT_BLEED, engineRef, reduced: reducedProp, maxParticles, glow = true }: FxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine] = useState(() => createFxEngine());
  const osReduced = useReducedMotion() ?? false;
  const reduced = reducedProp ?? osReduced;
  const liveSource = useMemo(() => createLiveFxSource(mode), [mode]);
  const src = source ?? liveSource;

  useEffect(() => {
    if (engineRef) engineRef.current = engine;
    return () => {
      if (engineRef) engineRef.current = null;
    };
  }, [engine, engineRef]);

  // 설정은 구독보다 먼저 반영한다(같은 커밋 안의 effect는 선언 순서대로 돈다)
  useEffect(() => {
    engine.setTheme(theme);
    engine.setSkin(skin);
    engine.setReduced(reduced);
  }, [engine, theme, skin, reduced]);

  useEffect(() => {
    engine.setMaxParticles(maxParticles ?? MAX_PARTICLES);
    engine.setGlow(glow);
  }, [engine, maxParticles, glow]);

  // 캔버스 크기·좌표: 부모(킷 래퍼)의 실제 렌더 크기 + bleed 여백
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    // 캔버스는 CSS 변수를 못 쓰므로 brand 색을 한 번 읽어 둔다
    const brand = getComputedStyle(canvas).getPropertyValue('--brand').trim();
    if (brand) engine.setBrand(brand);

    let attached = false;
    const update = () => {
      const w = host.clientWidth;
      if (!(w > 0)) return;
      const scale = w / DRUM_KIT_W;
      const h = DRUM_KIT_H * scale;
      const bx = Math.round(w * bleed);
      const by = Math.round(h * bleed);
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const view: FxView = { width: w + bx * 2, height: h + by * 2, scale, offsetX: bx, offsetY: by, dpr };
      canvas.style.left = `${-bx}px`;
      canvas.style.top = `${-by}px`;
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
  }, [engine, bleed]);

  // 이벤트 구독: 타격마다 React를 거치지 않고 엔진으로 간다
  useEffect(() => src((e) => engine.emit(e)), [engine, src]);

  return <canvas ref={canvasRef} className="fx-canvas" aria-hidden="true" data-fx-theme={theme} />;
}
