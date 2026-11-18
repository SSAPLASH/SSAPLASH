// 레인 → 패드 연결 층(설계 MODE-001-game-neon-link). 칠 때는 레인 플래시가 띠가 되어 패드까지 이어지고(타격 띠),
// 가이드를 켠 사용자에게는 다음에 칠 패드까지 점선이 보인다. 경로 계산은 laneLinkGeometry, 여기는 캔버스에 칠하기만 한다.
import { useEffect, useRef } from 'react';
import type { PadId } from '@/domain/kit/pads';
import { HIGHWAY_LANES, laneColorOf } from '@/features/play/domain/highwayLanes';
import { laneLinks, type LaneLink, type LinkPoint } from './laneLinkGeometry';
import './lane-link.css';

export type GuideLevel = 'now' | 'next' | 'later';

export interface LaneLinkLayerProps {
  /** 패드 → 마지막 타격 시각(performance.now()). 하이웨이의 레인 플래시와 같은 참조 */
  flashes: React.RefObject<Map<PadId, number>>;
  kitScale: number;
  /** 가이드: 레인(채보 패드) → 단계. 가이드가 꺼져 있으면 넘기지 않는다 */
  guide?: Partial<Record<PadId, GuideLevel>>;
}

/** 타격 띠가 사라지는 시간(ms) */
export const BAND_MS = 420;
const GUIDE_ALPHA: Record<GuideLevel, number> = { now: 1, next: 0.7, later: 0.45 };

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function trace(ctx: CanvasRenderingContext2D, pts: readonly LinkPoint[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

export function LaneLinkLayer(props: LaneLinkLayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let raf = 0;
    let links: LaneLink[] = [];
    let linksKey = '';
    // 지난 프레임에 아무것도 안 그렸으면 다시 지우지 않는다
    let dirty = true;

    const draw = () => {
      const p = propsRef.current;
      const now = performance.now();
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        dirty = true;
      }
      const key = `${W}|${p.kitScale}`;
      if (key !== linksKey) {
        linksKey = key;
        links = laneLinks({ width: W, kitScale: p.kitScale, lanes: HIGHWAY_LANES });
      }

      const active = links.filter((l) => {
        const at = p.flashes.current?.get(l.lane);
        return (at !== undefined && now - at < BAND_MS) || p.guide?.[l.lane] !== undefined;
      });
      if (active.length === 0 && !dirty) {
        raf = requestAnimationFrame(draw);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      dirty = active.length > 0;

      for (const l of active) {
        const color = laneColorOf(l.lane);
        const at = p.flashes.current?.get(l.lane);
        const left = at === undefined ? 0 : Math.max(0, 1 - (now - at) / BAND_MS);
        const hot = left * left;
        if (hot > 0) {
          // 타격 띠: 위 50% → 아래 17.5%에 남은 세기를 곱한다
          const y0 = l.band[0][1];
          const y1 = l.band[l.band.length - 1][1];
          const g = ctx.createLinearGradient(0, y0, 0, y1);
          g.addColorStop(0, rgba(color, 0.5 * hot));
          g.addColorStop(1, rgba(color, 0.175 * hot));
          ctx.strokeStyle = g;
          ctx.lineWidth = l.bandWidth;
          ctx.lineJoin = 'bevel';
          ctx.lineCap = 'butt';
          trace(ctx, l.band);
          ctx.stroke();
        }
      }
      // 가이드 점선은 띠를 다 그린 뒤 그 위에 그린다(띠에 묻히지 않게). 패드 쪽으로 흐른다(모션 줄이기면 멈춤)
      for (const l of active) {
        const level = p.guide?.[l.lane];
        if (level === undefined) continue;
        const color = laneColorOf(l.lane);
        ctx.save();
        ctx.strokeStyle = rgba(color, GUIDE_ALPHA[level]);
        ctx.lineWidth = level === 'now' ? 3 : 2;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = reduced ? 0 : -((now / 30) % 12);
        ctx.lineJoin = 'miter';
        ctx.shadowColor = color;
        ctx.shadowBlur = level === 'now' ? 8 : 4;
        trace(ctx, l.points);
        ctx.stroke();
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="lane-link" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
