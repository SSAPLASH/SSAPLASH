// 가상 드럼 키트 캔버스. 세팅(드래그 배치)·캘리브레이션(목표 패드·자세 마커·앵커)·자유 연주(타격 플래시)에 공용.
import { useEffect, useRef } from 'react';
import { ALL_PADS, PAD_META, type KitLayout, type PadId } from '@/domain/pads';
import type { Pose } from '@/domain/events';
import type { PadAnchor } from '@/domain/calibration';
import { poseToScreen, radiusToScreen } from '@/domain/kitMapping';
import type { KeyMap } from '@/domain/keyMap';

export interface KitCanvasProps {
  layout: KitLayout;
  /** 타격 플래시: pad → performance.now() */
  flashes?: React.RefObject<Map<PadId, number>>;
  highlightPad?: PadId | null;
  anchors?: Partial<Record<PadId, PadAnchor>>;
  /** 자세 마커 (왼손, 오른손). 없으면 안 그림 */
  poses?: [Pose, Pose] | null;
  showPoses?: boolean;
  draggable?: boolean;
  onMovePad?: (pad: PadId, x: number, y: number) => void;
  keyMap?: KeyMap;
  /** 자세 마커가 가리키는 판정 결과 패드 (미리보기) */
  previewPad?: PadId | null;
  /** 캔버스 래퍼 요소를 돌려준다 (포인터 소스의 기준면 등록용) */
  surfaceRef?: (el: HTMLDivElement | null) => void;
  dimOthers?: boolean;
}

export function KitCanvas(props: KitCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const dragRef = useRef<{ pad: PadId; dx: number; dy: number } | null>(null);

  useEffect(() => {
    props.surfaceRef?.(wrapRef.current);
    return () => props.surfaceRef?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const draw = () => {
      const p = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const now = performance.now();

      // 앵커 영역 (캘리브레이션 결과)
      if (p.anchors) {
        for (const a of Object.values(p.anchors)) {
          if (!a) continue;
          const s = poseToScreen(a);
          const r = radiusToScreen(a.radius) * W;
          ctx.beginPath();
          ctx.arc(s.x * W, s.y * H, r, 0, Math.PI * 2);
          ctx.fillStyle = PAD_META[a.pad].color + '22';
          ctx.fill();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = PAD_META[a.pad].color + '99';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(s.x * W, s.y * H, 4, 0, Math.PI * 2);
          ctx.fillStyle = PAD_META[a.pad].color;
          ctx.fill();
        }
      }

      // 패드
      for (const pad of ALL_PADS) {
        const pl = p.layout[pad];
        const cx = pl.x * W;
        const cy = pl.y * H;
        const r = pl.r * W;
        const meta = PAD_META[pad];
        const flashAt = p.flashes?.current?.get(pad);
        const flash = flashAt !== undefined ? Math.max(0, 1 - (now - flashAt) / 220) : 0;
        const isTarget = p.highlightPad === pad;
        const dim = p.dimOthers && p.highlightPad && !isTarget;
        const isPreview = p.previewPad === pad;

        ctx.save();
        ctx.globalAlpha = dim ? 0.35 : 1;
        // 림
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = meta.color + (flash > 0 ? 'ff' : '2e');
        if (flash > 0) {
          ctx.fillStyle = meta.color;
          ctx.globalAlpha = 0.35 + flash * 0.65;
        }
        ctx.fill();
        ctx.globalAlpha = dim ? 0.35 : 1;
        ctx.lineWidth = isTarget || isPreview ? 4 : 2;
        ctx.strokeStyle = isTarget ? '#ffffff' : isPreview ? meta.color : meta.color + 'aa';
        ctx.stroke();
        if (isTarget) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 180);
          ctx.beginPath();
          ctx.arc(cx, cy, r + 8 + pulse * 6, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${0.25 + pulse * 0.35})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // 라벨
        ctx.fillStyle = '#f3efe6';
        ctx.font = `700 ${Math.max(12, r * 0.32)}px Pretendard Variable, Pretendard, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(meta.label, cx, cy - (p.keyMap ? r * 0.12 : 0));
        if (p.keyMap) {
          const keys = Object.entries(p.keyMap)
            .filter(([, b]) => b.pad === pad)
            .map(([code]) => code.replace('Key', '').replace('Space', '␣'))
            .join(' ');
          ctx.font = `600 ${Math.max(10, r * 0.24)}px Pretendard Variable, Pretendard, sans-serif`;
          ctx.fillStyle = 'rgba(243,239,230,0.7)';
          ctx.fillText(keys, cx, cy + r * 0.28);
        }
        ctx.restore();
      }

      // 자세 마커
      if (p.showPoses && p.poses) {
        const colors = ['#7cc4ff', '#ffa07c'];
        p.poses.forEach((pose, i) => {
          const s = poseToScreen(pose);
          const x = s.x * W;
          const y = s.y * H;
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.fillStyle = colors[i];
          ctx.globalAlpha = 0.9;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#0e1320';
          ctx.stroke();
          ctx.fillStyle = '#0e1320';
          ctx.font = '700 10px Pretendard Variable, Pretendard, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(i === 0 ? 'L' : 'R', x, y + 0.5);
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 드래그 배치 (SETUP-01)
  const hitTest = (clientX: number, clientY: number): { pad: PadId; nx: number; ny: number } | null => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    const aspect = rect.width / rect.height;
    for (const pad of [...ALL_PADS].reverse()) {
      const pl = propsRef.current.layout[pad];
      const dx = nx - pl.x;
      const dy = (ny - pl.y) / aspect;
      if (Math.hypot(dx, dy) <= pl.r) return { pad, nx, ny };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!props.draggable) return;
    const h = hitTest(e.clientX, e.clientY);
    if (!h) return;
    const pl = props.layout[h.pad];
    dragRef.current = { pad: h.pad, dx: pl.x - h.nx, dy: pl.y - h.ny };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !props.onMovePad) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width + d.dx;
    const ny = (e.clientY - rect.top) / rect.height + d.dy;
    props.onMovePad(d.pad, Math.min(0.95, Math.max(0.05, nx)), Math.min(0.95, Math.max(0.05, ny)));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className="kit-wrap"
      style={{ cursor: props.draggable ? 'grab' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
