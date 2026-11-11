// 가상 드럼 키트 캔버스(세팅의 드럼 배치). 원근 보기(내려다보는 각도 50°)로 패드·손별 판정 범위·자세 마커를 그린다. 끌기 편집은 draggable일 때만(kit-drag 설계 D6).
// 좌표 계산은 domain/kitPerspective, 칠하기는 kitPerspectiveDraw가 맡고 여기는 프레임 루프와 포인터 처리만 한다.
import { useEffect, useRef } from 'react';
import type { PadId } from '@/domain/pads';
import type { KitLayout } from '@/domain/kitLayout';
import type { HitFx, Pose } from '@/domain/events';
import type { HandAnchorSet } from '@/domain/calibration';
import { DEFAULT_ANGLE_RANGE, type AngleRange } from '@/domain/kitMapping';
import { HAND_ORIGINS, anchorToPoint } from '@/domain/kitModel';
import { dragToLayout, hitTestPads, kitShapes, makeCamera, poseOrigin, poseTip, screenPointToPose, type Camera, type PadShape } from '@/domain/kitPerspective';
import type { KeyMap } from '@/domain/keyMap';
import { paintAnchorZone, paintFloor, paintShadow, paintSolidHitFx, paintSolidPad, paintStick } from './kitPerspectiveDraw';

export interface KitCanvasProps {
  layout: KitLayout;
  /** 타격 이펙트(번쩍임·링·눌림·의성어) 입력. 화면이 useHitFx로 채운다 */
  hits?: React.RefObject<Map<PadId, HitFx>>;
  /** 패드를 톡 쳤을 때(이동 6px 이내). 끌기는 호출하지 않는다 */
  onTapPad?: (pad: PadId, nx: number, ny: number) => void;
  highlightPad?: PadId | null;
  /** 패드를 끌어 옮길 수 있다. 이동 6px 이내는 끌기가 아니라 톡 치기(onTapPad) */
  draggable?: boolean;
  /** 끄는 동안 포인터마다 호출. 위치는 0.05~0.95로 자른 배치 좌표(화면 좌표가 아니다) */
  onMovePad?: (pad: PadId, x: number, y: number) => void;
  /** 손별 판정 범위(왼손 파랑·오른손 주황). null인 손은 그리지 않는다 */
  anchorSets?: readonly [HandAnchorSet | null, HandAnchorSet | null];
  /** 자세 마커 (왼손, 오른손). 없으면 안 그림 */
  poses?: [Pose, Pose] | null;
  showPoses?: boolean;
  /** 자세 마커를 두 손 가운데에서 그린다(포인터 모의 IMU: 마우스 자세는 손 구분이 없다) */
  posesFromCenter?: boolean;
  keyMap?: KeyMap;
  /** 자세 마커가 가리키는 판정 결과 패드 (미리보기) */
  previewPad?: PadId | null;
  /** 캔버스 래퍼 요소와 "화면 정규 좌표(0~1) → 자세" 변환을 돌려준다 (포인터 소스의 기준면 등록용) */
  surfaceRef?: (el: HTMLDivElement | null, toPose?: (nx: number, ny: number) => Pose) => void;
  dimOthers?: boolean;
  /** 배치 좌표 ↔ 방향 변환에 쓰는 각도 범위. 기본 DEFAULT_ANGLE_RANGE */
  angleRange?: AngleRange;
}

/** 톡 치기와 끌기를 가르는 이동 거리(px) */
const TAP_SLOP_PX = 6;

export function KitCanvas(props: KitCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  /** 끌기: 잡은 자리 → 패드 윗면 중심의 차이(px) */
  const dragRef = useRef<{ pad: PadId; dx: number; dy: number } | null>(null);
  /** 포인터 다운 기록. 6px 넘게 움직이면 moved → 끌기, 아니면 업에서 톡 치기 */
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
    // 포인터 모의 IMU: 패드 위에 마우스를 두면 그 패드의 배치 자세가 되게 화면 → 자세 변환을 같이 넘긴다
    props.surfaceRef?.(wrapRef.current, (nx, ny) => {
      const { shapes, cam, rect } = shapesNow();
      return screenPointToPose(nx * rect.width, ny * rect.height, shapes, cam);
    });
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
      const cam = makeCamera({ w: W, h: H });
      // 먼 것부터 그린다
      const shapes = kitShapes(p.layout, cam, range);
      const reduced = reducedMotionRef.current;

      paintFloor(ctx, cam);
      for (const s of shapes) paintShadow(ctx, s);
      for (const s of shapes) {
        const isTarget = p.highlightPad === s.pad;
        const keys = p.keyMap
          ? Object.entries(p.keyMap)
              .filter(([, b]) => b.pad === s.pad)
              .map(([code]) => code.replace('Key', '').replace('Space', '␣'))
              .join(' ')
          : undefined;
        paintSolidPad(ctx, s, {
          fx: p.hits?.current?.get(s.pad),
          now,
          reduced,
          target: isTarget,
          preview: p.previewPad === s.pad,
          dim: Boolean(p.dimOthers && p.highlightPad && !isTarget),
          keys,
        });
      }

      // 손별 판정 범위(보정 결과). 그 손 출발점에서 앵커 방향으로 모델 거리만큼 간 자리
      if (p.anchorSets) {
        p.anchorSets.forEach((set, hand) => {
          if (!set) return;
          const h = hand as 0 | 1;
          const o = HAND_ORIGINS[h];
          for (const a of Object.values(set)) {
            if (!a) continue;
            const cm = anchorToPoint(h, a.pad, a);
            if (!cm) continue;
            const pt = [cm.x / 100, cm.y / 100, cm.z / 100] as const;
            const dist = Math.hypot(pt[0] - o[0], pt[1] - o[1], pt[2] - o[2]);
            const q = cam.project(pt);
            paintAnchorZone(ctx, h, a.pad, q.sx, q.sy, dist * Math.tan((a.radius * Math.PI) / 180) * q.scale);
          }
        });
      }

      // 링·의성어 (모든 패드 위에 그린다)
      if (p.hits?.current && !reduced) {
        for (const s of shapes) {
          const fx = p.hits.current.get(s.pad);
          if (fx) paintSolidHitFx(ctx, s, fx, now);
        }
      }

      // 자세 마커: 손 출발점에서 스틱이 가리키는 끝점까지
      if (p.showPoses && p.poses) {
        p.poses.forEach((pose, i) => {
          const from = p.posesFromCenter ? 'center' : (i as 0 | 1);
          paintStick(ctx, i as 0 | 1, cam.project(poseOrigin(from)), cam.project(poseTip(from, pose, shapes)));
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 지금 래퍼 크기 기준 패드 모양(먼 것부터). 포인터 처리는 프레임 루프와 따로 계산한다 */
  const shapesNow = (): { shapes: PadShape[]; cam: Camera; rect: DOMRect } => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const cam = makeCamera({ w: rect.width, h: rect.height });
    return { shapes: kitShapes(propsRef.current.layout, cam, propsRef.current.angleRange ?? DEFAULT_ANGLE_RANGE), cam, rect };
  };

  // 패드 톡 치기(선택)와 끌기(draggable). 끌기는 앵커도 같이 옮긴다(kit-drag 설계 D2·D6)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!props.draggable && !props.onTapPad) return;
    const { shapes, rect } = shapesNow();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const pad = hitTestPads(shapes, px, py);
    if (!pad) return;
    pressRef.current = { pad, x: e.clientX, y: e.clientY, moved: false };
    if (props.draggable) {
      // 잡은 자리와 패드 윗면 중심의 차이를 기억해 패드가 포인터로 튀지 않게 한다
      const s = shapes.find((v) => v.pad === pad)!;
      dragRef.current = { pad, dx: s.cx - px, dy: s.cy - py };
      // 합성 포인터 이벤트(테스트·자동화)는 활성 포인터가 없어 캡처가 실패한다. 캡처는 끌기 보조일 뿐이라 무시한다
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* 활성 포인터 없음 */
      }
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const press = pressRef.current;
    if (press && !press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) press.moved = true;
    const d = dragRef.current;
    // 6px 안쪽 움직임은 톡 치기로 보고 패드를 옮기지 않는다
    if (!d || !press?.moved || !props.draggable || !props.onMovePad) return;
    const { cam, rect } = shapesNow();
    const next = dragToLayout(d.pad, e.clientX - rect.left + d.dx, e.clientY - rect.top + d.dy, props.layout[d.pad], cam, props.angleRange ?? DEFAULT_ANGLE_RANGE);
    props.onMovePad(d.pad, next.x, next.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    dragRef.current = null;
    if (!press || press.moved || e.type === 'pointercancel') return;
    const rect = wrapRef.current!.getBoundingClientRect();
    props.onTapPad?.(press.pad, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  return (
    <div
      ref={wrapRef}
      className="kit-wrap"
      data-pointer-strike=""
      style={{ cursor: props.draggable ? 'grab' : props.onTapPad ? 'pointer' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
