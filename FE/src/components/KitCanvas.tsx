// 가상 드럼 키트 캔버스(표시 전용, PLAY-004 D2). 세팅의 배치 확인(손별 앵커 원·자세 마커)과 로그인 화면 장식에 공용. 드래그 편집은 없다.
import { useEffect, useRef } from 'react';
import { LANE_PADS, PAD_META, type PadId } from '@/domain/pads';
import type { KitLayout } from '@/domain/kitLayout';
import type { HitFx, Pose } from '@/domain/events';
import type { HandAnchorSet } from '@/domain/calibration';
import { DEFAULT_ANGLE_RANGE, poseToScreen, radiusToScreen, type AngleRange } from '@/domain/kitMapping';
import type { KeyMap } from '@/domain/keyMap';

export interface KitCanvasProps {
  layout: KitLayout;
  /** 타격 이펙트(번쩍임·링·눌림·의성어) 입력. 화면이 useHitFx로 채운다 */
  hits?: React.RefObject<Map<PadId, HitFx>>;
  /** 패드를 톡 쳤을 때(이동 6px 이내). 끌기는 호출하지 않는다 */
  onTapPad?: (pad: PadId, nx: number, ny: number) => void;
  highlightPad?: PadId | null;
  /** 손별 판정 앵커 원(왼손 파랑·오른손 주황). null인 손은 그리지 않는다 */
  anchorSets?: readonly [HandAnchorSet | null, HandAnchorSet | null];
  /** 자세 마커 (왼손, 오른손). 없으면 안 그림 */
  poses?: [Pose, Pose] | null;
  showPoses?: boolean;
  keyMap?: KeyMap;
  /** 자세 마커가 가리키는 판정 결과 패드 (미리보기) */
  previewPad?: PadId | null;
  /** 캔버스 래퍼 요소를 돌려준다 (포인터 소스의 기준면 등록용) */
  surfaceRef?: (el: HTMLDivElement | null) => void;
  dimOthers?: boolean;
  /** 판정 원·자세 마커를 그릴 때 쓰는 각도 범위. 기본 DEFAULT_ANGLE_RANGE */
  angleRange?: AngleRange;
}

/** 톡 치기로 보는 최대 이동 거리(px) */
const TAP_SLOP_PX = 6;
/** 손 색(왼손, 오른손). 자세 마커와 앵커 원이 같이 쓴다 */
const HAND_COLORS = ['#7cc4ff', '#ffa07c'] as const;
const FLASH_MS = 220;
const RING_MS = 500;
const SQUASH_MS = 280;
const TEXT_MS = 700;

/** 눌림/튕김 크기 배율 곡선: 0→1, 18%→0.86, 55%→1.07, 100%→1 (구간 선형) */
function squashScale(u: number, amp: number): number {
  const keys: [number, number][] = [
    [0, 1],
    [0.18, 0.86],
    [0.55, 1.07],
    [1, 1],
  ];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [u0, k0] = keys[i - 1];
      const [u1, k1] = keys[i];
      const k = k0 + ((k1 - k0) * (u - u0)) / (u1 - u0);
      return 1 + (k - 1) * amp;
    }
  }
  return 1;
}

/** 세기 → 눌림 진폭. 64면 0.7배, 120이면 1.3배 */
function squashAmp(velocity: number): number {
  return Math.min(1.5, Math.max(0.5, 0.7 + ((velocity - 64) / 56) * 0.6));
}

export function KitCanvas(props: KitCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  /** 포인터 다운 기록. 6px 넘게 움직이면 moved(톡 치기 아님) */
  const pressRef = useRef<{ pad: PadId; x: number; y: number; moved: boolean } | null>(null);
  /** 모션 줄이기 환경이면 링·눌림·의성어를 생략하고 번쩍임만 그린다 */
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const on = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

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
      const range = p.angleRange ?? DEFAULT_ANGLE_RANGE;

      // 손별 앵커 영역(보정 결과). 색은 손, 중심 점은 패드 색
      if (p.anchorSets) {
        p.anchorSets.forEach((set, hand) => {
          if (!set) return;
          const color = HAND_COLORS[hand];
          for (const a of Object.values(set)) {
            if (!a) continue;
            const s = poseToScreen(a, range);
            const r = radiusToScreen(a.radius, range) * W;
            ctx.beginPath();
            ctx.arc(s.x * W, s.y * H, r, 0, Math.PI * 2);
            ctx.fillStyle = color + '14';
            ctx.fill();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = color + '99';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(s.x * W, s.y * H, 4, 0, Math.PI * 2);
            ctx.fillStyle = PAD_META[a.pad].color;
            ctx.fill();
          }
        });
      }

      // 패드
      for (const pad of LANE_PADS) {
        const pl = p.layout[pad];
        const cx = pl.x * W;
        const cy = pl.y * H;
        const r = pl.r * W;
        const meta = PAD_META[pad];
        const fx = p.hits?.current?.get(pad);
        const age = fx ? now - fx.at : Infinity;
        const flash = fx ? Math.max(0, 1 - age / FLASH_MS) : 0;
        const reduced = reducedMotionRef.current;
        const isTarget = p.highlightPad === pad;
        const dim = p.dimOthers && p.highlightPad && !isTarget;
        const isPreview = p.previewPad === pad;

        ctx.save();
        // 눌림/튕김: 패드 중심 기준 배율
        if (fx && !reduced && age < SQUASH_MS) {
          const sc = squashScale(age / SQUASH_MS, squashAmp(fx.velocity));
          ctx.translate(cx, cy);
          ctx.scale(sc, sc);
          ctx.translate(-cx, -cy);
        }
        ctx.globalAlpha = dim ? 0.35 : 1;
        // 림
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = meta.color + (flash > 0 ? 'ff' : '2e');
        if (flash > 0) {
          ctx.fillStyle = meta.color;
          ctx.globalAlpha = 0.18 + flash * 0.82;
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

      // 링·의성어 (모든 패드 위에 그린다)
      if (p.hits?.current && !reducedMotionRef.current) {
        for (const pad of LANE_PADS) {
          const fx = p.hits.current.get(pad);
          if (!fx) continue;
          const age = now - fx.at;
          const pl = p.layout[pad];
          const cx = pl.x * W;
          const cy = pl.y * H;
          const r = pl.r * W;
          const color = PAD_META[pad].color;
          if (age < RING_MS) {
            const u = age / RING_MS;
            const ease = 1 - Math.pow(1 - u, 3);
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, r * (0.9 + 1.0 * ease), 0, Math.PI * 2);
            ctx.globalAlpha = 0.9 * (1 - u);
            ctx.lineWidth = 3;
            ctx.strokeStyle = color;
            ctx.stroke();
            ctx.restore();
          }
          if (age < TEXT_MS) {
            const u = age / TEXT_MS;
            const alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
            const size = Math.max(14, r * 0.45 * (0.8 + (fx.velocity / 127) * 0.4));
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
            ctx.fillStyle = color;
            ctx.font = `800 ${size}px Pretendard Variable, Pretendard, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 6;
            ctx.fillText(PAD_META[pad].onomatopoeia, cx, cy - r * (0.7 + 1.0 * u));
            ctx.restore();
          }
        }
      }

      // 자세 마커
      if (p.showPoses && p.poses) {
        const colors = HAND_COLORS;
        p.poses.forEach((pose, i) => {
          const s = poseToScreen(pose, range);
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

  // 패드 톡 치기(선택). 끌기는 없다(배치는 보정 결과에서 유도, PLAY-004 D2)
  const hitTest = (clientX: number, clientY: number): { pad: PadId; nx: number; ny: number } | null => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    const aspect = rect.width / rect.height;
    for (const pad of [...LANE_PADS].reverse()) {
      const pl = propsRef.current.layout[pad];
      const dx = nx - pl.x;
      const dy = (ny - pl.y) / aspect;
      if (Math.hypot(dx, dy) <= pl.r) return { pad, nx, ny };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!props.onTapPad) return;
    const h = hitTest(e.clientX, e.clientY);
    if (!h) return;
    pressRef.current = { pad: h.pad, x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const press = pressRef.current;
    if (press && !press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) press.moved = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.moved || e.type === 'pointercancel') return;
    const rect = wrapRef.current!.getBoundingClientRect();
    props.onTapPad?.(press.pad, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  return (
    <div
      ref={wrapRef}
      className="kit-wrap"
      style={{ cursor: props.onTapPad ? 'pointer' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
