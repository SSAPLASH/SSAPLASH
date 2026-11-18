// 랜딩 센서 스틱 무대: 캔버스 크기·DPR·색 토큰을 맞추고 프레임마다 그린다(React state는 바꾸지 않는다).
import { useCallback, useEffect, useRef, useState } from 'react';
import { stickLayers } from '@/features/landing/domain/landingMotion';
import { buildLayoutA, layoutBounds, type StageLayout, type StageStep } from '@/features/landing/domain/stickLayout';
import { fitCamera } from '@/features/landing/domain/stickSpace';
import { hitsBetween, poseAt } from '@/features/landing/domain/stickStroke';
import { DEFAULT_BRAND, drawStage, parseCssColor, type StageLayers } from './stickStageDraw';
import { useStickSwing } from './useStickSwing';

interface Props {
  /** 0 측정·1 판별·2 전달. 보일 층과 치는 순서를 정한다 */
  step: StageStep;
  /** true면 루프 없이 정지 화면 한 장만 그린다 */
  reduce: boolean;
}

// 층 투명도가 목표값에 다가가는 시간 상수(초)
const LAYER_TAU = 0.3;
// 모션 줄이기 정지 화면의 시각: 오른손 강세가 스네어에 맞은 직후
const STILL_TIME = 0.03;
const FALLBACK_FONT = "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif";

interface View {
  ctx: CanvasRenderingContext2D;
  layout: StageLayout;
  width: number;
  height: number;
  dpr: number;
  brand: ReturnType<typeof parseCssColor>;
  font: string;
}

export function StickStage({ step, reduce }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout] = useState(buildLayoutA);
  const [bounds] = useState(() => layoutBounds(layout));
  const viewRef = useRef<View | null>(null);
  const stepRef = useRef(step);
  const layersRef = useRef<StageLayers>(stickLayers(step));
  const lastT = useRef(0);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  // 한 프레임: 층 투명도를 목표로 다가가게 하고 포즈·타격을 계산해 그린다
  const paint = useCallback(
    (t: number, forced: StageStep | null) => {
      const view = viewRef.current;
      if (!view) return;
      const st = forced ?? stepRef.current;
      const target = stickLayers(st);
      const cur = layersRef.current;
      if (forced !== null || t < lastT.current) {
        // 정지 화면이거나 화면에 다시 들어온 첫 프레임이면 목표값으로 바로 맞춘다
        cur.pad = target.pad;
        cur.imu = target.imu;
        cur.ble = target.ble;
      } else {
        const k = 1 - Math.exp(-(t - lastT.current) / LAYER_TAU);
        cur.pad += (target.pad - cur.pad) * k;
        cur.imu += (target.imu - cur.imu) * k;
        cur.ble += (target.ble - cur.ble) * k;
      }
      lastT.current = t;
      drawStage(view.ctx, {
        layout: view.layout,
        width: view.width,
        height: view.height,
        dpr: view.dpr,
        t,
        step: st,
        poses: view.layout.sticks.map((_, i) => poseAt(view.layout, i, t, st)),
        hits: hitsBetween(view.layout, t - 1, t, st),
        layers: cur,
        brand: view.brand,
        font: view.font,
      });
    },
    [],
  );

  // 캔버스 크기·DPR·색을 맞춘다. 모션 줄이기면 크기가 바뀔 때마다 정지 화면을 다시 그린다.
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) return; // 캔버스를 쓸 수 없으면 조용히 넘어간다(장식이다)

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const style = getComputedStyle(stage);
      const brandText = style.getPropertyValue('--brand');
      viewRef.current = {
        ctx,
        layout: { ...layout, camera: fitCamera(layout.camera, bounds, rect.width, rect.height) },
        width: rect.width,
        height: rect.height,
        dpr,
        brand: parseCssColor(brandText, DEFAULT_BRAND),
        font: style.fontFamily || FALLBACK_FONT,
      };
      if (reduce) paint(STILL_TIME, 2);
    };

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    ro?.observe(stage);
    resize();
    return () => {
      ro?.disconnect();
      viewRef.current = null;
    };
  }, [layout, bounds, reduce, paint]);

  useStickSwing({
    stageRef,
    enabled: !reduce,
    onFrame: (t) => paint(t, null),
  });

  return (
    <div ref={stageRef} className="lp-stage">
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
