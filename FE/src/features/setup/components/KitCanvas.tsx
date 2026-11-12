// 드럼 세팅의 드럼 배치 그림(편집). 원근 자리(내려다보는 각도 50°)에 사용자가 고른 드럼 모양(skin)의 패드를 놓는다.
// 패드 그림은 보정 화면과 같은 DrumKit(자유 틀, domain/kit/kitFrame)이 그리고, 여기는 그 아래(바닥 격자·그림자)와 위(손별 판정 범위·L·R 표식)의
// 캔버스 층, 그리고 고르기·끌기 포인터 처리를 맡는다. 좌표 계산은 domain/kit/kitPerspective 몫이다. 끌기 편집은 draggable일 때만(kit-drag 설계 D6).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PadId } from '@/domain/pads';
import type { KitLayout } from '@/domain/kitLayout';
import type { Pose } from '@/domain/events';
import type { HandAnchorSet } from '@/domain/calibration';
import type { KitSkin } from '@/domain/drumKit';
import { frameOf } from '@/domain/kit/kitFrame';
import { DEFAULT_ANGLE_RANGE, type AngleRange } from '@/domain/kit/kitMapping';
import { HAND_ORIGINS, anchorToPoint } from '@/domain/kit/kitModel';
import { dragToLayout, hitTestPads, isMovablePad, kitShapes, makeCamera, poseTip, screenPointToPose, type Camera, type PadShape } from '@/domain/kit/kitPerspective';
import type { KeyMap } from '@/domain/keyMap';
import { DrumKit } from '@/components/drum/DrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { canvasBleed, paintAnchorZone, paintFloor, paintShadow, paintStickTip } from './kitPerspectiveDraw';

export interface KitCanvasProps {
  layout: KitLayout;
  /** 드럼 모양. 보정 화면과 같은 설정값(kitSkin)을 넘긴다. 기본 실물 */
  skin?: KitSkin;
  /** 패드를 톡 쳤을 때(이동 6px 이내). 끌기는 호출하지 않는다 */
  onTapPad?: (pad: PadId, nx: number, ny: number) => void;
  /** 선택 패드. 선택 링을 그린다 */
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
  /** 패드 위 알약 배지로 키를 보인다 */
  keyMap?: KeyMap;
  /** 자세 마커가 가리키는 판정 결과 패드 (미리보기). 그 패드를 밝힌다 */
  previewPad?: PadId | null;
  /** 래퍼 요소와 "화면 정규 좌표(0~1) → 자세" 변환을 돌려준다 (포인터 소스의 기준면 등록용) */
  surfaceRef?: (el: HTMLDivElement | null, toPose?: (nx: number, ny: number) => Pose) => void;
  /** 배치 좌표 ↔ 방향 변환에 쓰는 각도 범위. 기본 DEFAULT_ANGLE_RANGE */
  angleRange?: AngleRange;
}

/** 톡 치기와 끌기를 가르는 이동 거리(px) */
const TAP_SLOP_PX = 6;

/**
 * 캔버스를 그림 영역 크기·화면 배율에 맞추고 지운다. 좌표 원점은 그림 영역의 왼쪽 위다.
 * 캔버스가 그림 영역보다 크면(넘침) 그만큼 원점을 안쪽으로 옮겨, 그림 영역 밖으로 나간 패드 둘레도 그려지게 한다
 */
function prepare(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const bleed = canvasBleed(canvas.clientWidth, w);
  const bw = Math.round((w + 2 * bleed) * dpr);
  const bh = Math.round((h + 2 * bleed) * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, bleed * dpr, bleed * dpr);
  ctx.clearRect(-bleed, -bleed, w + 2 * bleed, h + 2 * bleed);
  return ctx;
}

export function KitCanvas(props: KitCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  /** 끌기: 잡은 자리 → 패드 윗면 중심의 차이(px) */
  const dragRef = useRef<{ pad: PadId; dx: number; dy: number } | null>(null);
  /** 포인터 다운 기록. 6px 넘게 움직이면 moved → 끌기, 아니면 업에서 톡 치기 */
  const pressRef = useRef<{ pad: PadId; x: number; y: number; moved: boolean } | null>(null);
  /** 그림 영역 크기(px). 재기 전에는 null이라 패드를 그리지 않는다 */
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const padStates = usePadStates();
  const hitSeq = usePadHitSeq();

  useEffect(() => {
    const el = wrapRef.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox((b) => (b && b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const range = props.angleRange ?? DEFAULT_ANGLE_RANGE;
  const skin = props.skin ?? 'acoustic';
  // 패드 모양(먼 것부터)과 스킨 그림 자리. 그리기·클릭 판정·끌기가 같은 값을 쓴다
  const scene = useMemo(() => {
    if (!box) return null;
    const cam = makeCamera(box, range);
    const shapes = kitShapes(props.layout, cam, range);
    return { cam, shapes, frame: frameOf(shapes, box, skin) };
  }, [box, props.layout, range, skin]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  /** 포인터 처리용: 지금 래퍼 크기 기준 모양. 아직 못 쟀으면 그 자리에서 잰다 */
  const sceneNow = (): { shapes: PadShape[]; cam: Camera; rect: DOMRect } => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const cur = sceneRef.current;
    if (cur && cur.cam.w === rect.width && cur.cam.h === rect.height) return { shapes: cur.shapes, cam: cur.cam, rect };
    const r = propsRef.current.angleRange ?? DEFAULT_ANGLE_RANGE;
    const cam = makeCamera({ w: rect.width, h: rect.height }, r);
    return { shapes: kitShapes(propsRef.current.layout, cam, r), cam, rect };
  };

  useEffect(() => {
    // 포인터 모의 IMU: 패드 위에 마우스를 두면 그 패드의 배치 자세가 되게 화면 → 자세 변환을 같이 넘긴다
    props.surfaceRef?.(wrapRef.current, (nx, ny) => {
      const { shapes, cam, rect } = sceneNow();
      return screenPointToPose(nx * rect.width, ny * rect.height, shapes, cam, propsRef.current.angleRange ?? DEFAULT_ANGLE_RANGE);
    });
    return () => props.surfaceRef?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 아래층: 바닥 격자와 그림자. 배치·크기가 바뀔 때만 다시 그린다
  useEffect(() => {
    const canvas = underRef.current;
    if (!canvas || !scene) return;
    const ctx = prepare(canvas, scene.cam.w, scene.cam.h);
    if (!ctx) return;
    paintFloor(ctx, scene.cam);
    for (const s of scene.shapes) paintShadow(ctx, s);
  }, [scene]);

  // 위층: 손별 판정 범위와 L·R 표식. 자세가 계속 바뀌므로 프레임마다 그린다
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = overRef.current;
      const sc = sceneRef.current;
      if (!canvas || !sc) return;
      const ctx = prepare(canvas, sc.cam.w, sc.cam.h);
      if (!ctx) return;
      const p = propsRef.current;
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
            const q = sc.cam.place(pt);
            paintAnchorZone(ctx, h, a.pad, q.sx, q.sy, dist * Math.tan((a.radius * Math.PI) / 180) * q.scale);
          }
        });
      }
      // 자세 마커: 스틱이 가리키는 끝점에 L·R 표식만 그린다(손에서 잇는 선은 없다)
      if (p.showPoses && p.poses) {
        p.poses.forEach((pose, i) => {
          const from = p.posesFromCenter ? 'center' : (i as 0 | 1);
          paintStickTip(ctx, i as 0 | 1, sc.cam.place(poseTip(from, pose, sc.shapes)));
        });
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 패드 톡 치기(선택)와 끌기(draggable). 끌기는 앵커도 같이 옮긴다(kit-drag 설계 D2·D6)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!props.draggable && !props.onTapPad) return;
    const { shapes, rect } = sceneNow();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const pad = hitTestPads(shapes, px, py);
    if (!pad) return;
    pressRef.current = { pad, x: e.clientX, y: e.clientY, moved: false };
    // 킥은 자리가 고정이고 하이햇 페달은 하이햇을 따라다녀 끌지 않는다(톡 쳐서 고르기만)
    if (props.draggable && isMovablePad(pad)) {
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
    const { cam, rect } = sceneNow();
    const next = dragToLayout(d.pad, e.clientX - rect.left + d.dx, e.clientY - rect.top + d.dy, props.layout[d.pad], cam, range);
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

  // 키 표시: 패드 위 배지
  const badges = useMemo(() => {
    if (!props.keyMap) return undefined;
    const out: Partial<Record<PadId, string>> = {};
    for (const [code, b] of Object.entries(props.keyMap)) {
      const key = code.replace('Key', '').replace('Space', '␣');
      out[b.pad] = out[b.pad] ? `${out[b.pad]} ${key}` : key;
    }
    return out;
  }, [props.keyMap]);

  return (
    <div
      ref={wrapRef}
      className="kit-wrap kit-stack"
      data-pointer-strike=""
      style={{ cursor: props.draggable ? 'grab' : props.onTapPad ? 'pointer' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={underRef} />
      {scene && (
        <DrumKit
          frame={scene.frame}
          skin={skin}
          states={padStates}
          hitSeq={hitSeq}
          badges={badges}
          selectedPad={props.highlightPad ?? undefined}
          lit={props.previewPad ?? undefined}
        />
      )}
      <canvas ref={overRef} />
    </div>
  );
}
