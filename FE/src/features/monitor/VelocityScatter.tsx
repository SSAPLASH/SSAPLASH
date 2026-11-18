// 추이·분포 탭 오른쪽: 세기 산점. HIT 최근 300건을 velocity(세로) × peakSpeed/decel/swingMs(가로, 토글)로 그린다.
// 펌웨어 세기 곡선을 가정하지 않으므로 추정선은 그리지 않는다. 계산(중앙값·스피어만)은 monitor/syncTrend.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { median, spearman } from '@/features/monitor/core/syncTrend';
import { cssVar, fmt, prepareCanvas, stickName, type Snap } from './monitorTypes';

const MAX_POINTS = 300;
const RECENT = 10;
const PAD_L = 34;
const PAD_B = 18;
const PAD_T = 8;
const PAD_R = 10;
const VEL_GRID = [32, 64, 96, 127];
const HOVER_PX = 12;
/** 이 값 미만이면 노랑 */
const CORR_WARN = 0.5;
/** 표본이 이보다 적으면 상관을 계산하지 않는다(몇 건으로는 경고가 거짓으로 뜬다) */
const MIN_CORR_N = 10;

type AxisKey = 'peak' | 'decel' | 'swing';
const AXES: { key: AxisKey; label: string; minMax: number }[] = [
  { key: 'peak', label: 'peakSpeed (°/s)', minMax: 1000 },
  { key: 'decel', label: 'decel', minMax: 25 },
  { key: 'swing', label: 'swingMs (ms)', minMax: 250 },
];

interface Pt {
  stick: 0 | 1;
  seq: number;
  pad: string;
  peak: number;
  decel: number;
  swing: number;
  vel: number;
  ambiguous: boolean;
}

interface Placed {
  x: number;
  y: number;
  p: Pt;
}

export const VelocityScatter = memo(function VelocityScatter({
  snap,
  onPick,
}: {
  snap: Snap;
  /** 점 클릭. 페이지가 HIT 탭으로 전환한다 */
  onPick: (stick: 0 | 1, seq: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const placed = useRef<Placed[]>([]);
  const [axis, setAxis] = useState<AxisKey>('peak');
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const points = useMemo(() => {
    const out: Pt[] = [];
    for (let i = snap.rows.length - 1; i >= 0 && out.length < MAX_POINTS; i--) {
      const r = snap.rows[i];
      const d = r.decoded;
      if (r.dir !== 'in' || d?.kind !== 'hit' || r.stick === null) continue;
      out.push({
        stick: r.stick,
        seq: d.seq,
        pad: d.pad ?? '없음',
        peak: d.peakSpeedDps,
        decel: d.decel,
        swing: d.swingMs,
        vel: d.velocity,
        ambiguous: d.ambiguous,
      });
    }
    return out.reverse();
  }, [snap.rows]);

  const axisMeta = AXES.find((a) => a.key === axis) ?? AXES[0];

  useEffect(() => {
    const el = ref.current;
    const c = prepareCanvas(el);
    if (!c || !el) return;
    const { ctx, w, h } = c;
    const colors = [cssVar(el, '--left', '#7cc4ff'), cssVar(el, '--right', '#ffa07c')];
    const line = cssVar(el, '--line', '#34405c');
    const faint = cssVar(el, '--text-3', '#6e778d');
    const ink = cssVar(el, '--text-1', '#e8ecf5');
    const plotW = w - PAD_L - PAD_R;
    const plotH = h - PAD_T - PAD_B;
    const xMax = Math.max(axisMeta.minMax, ...points.map((p) => p[axis]));
    const xOf = (v: number) => PAD_L + (v / xMax) * plotW;
    const yOf = (v: number) => PAD_T + plotH - (v / 127) * plotH;

    ctx.font = '10px monospace';
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_L + 0.5, PAD_T + 0.5, plotW - 1, plotH - 1);
    ctx.fillStyle = faint;
    ctx.textAlign = 'right';
    for (const v of VEL_GRID) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(PAD_L, yOf(v));
      ctx.lineTo(w - PAD_R, yOf(v));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(String(v), PAD_L - 4, yOf(v) + 3);
    }
    ctx.fillText('0', PAD_L - 4, yOf(0));
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const v = (xMax * i) / 4;
      if (i > 0 && i < 4) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(xOf(v), PAD_T);
        ctx.lineTo(xOf(v), PAD_T + plotH);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillText(v.toFixed(0), xOf(v), h - 5);
    }
    ctx.textAlign = 'start';
    ctx.fillText(`velocity (세로) × ${axisMeta.label} (가로)`, PAD_L + 6, PAD_T + 11);

    const found: Placed[] = [];
    points.forEach((p, i) => {
      const x = xOf(p[axis]);
      const y = yOf(p.vel);
      const recent = i >= points.length - RECENT;
      if (recent) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      if (p.ambiguous) {
        ctx.strokeStyle = colors[p.stick];
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = colors[p.stick];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      found.push({ x, y, p });
    });
    placed.current = found;
  }, [points, axis, axisMeta]);

  const nearest = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    let best: Placed | null = null;
    let bd = HOVER_PX;
    // 겹치면 최신 점을 우선하도록 뒤에서부터 본다
    for (let i = placed.current.length - 1; i >= 0; i--) {
      const q = placed.current[i];
      const d = Math.hypot(q.x - cx, q.y - cy);
      if (d <= bd) {
        bd = d;
        best = q;
      }
    }
    return { best, cx, cy };
  };

  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const { best, cx, cy } = nearest(ev);
    if (!best) {
      setTip(null);
      return;
    }
    const p = best.p;
    setTip({
      x: cx,
      y: cy,
      text: `${stickName(p.stick)} seq ${p.seq} · pad ${p.pad} · peakSpeed ${p.peak} · velocity ${p.vel} · decel ${fmt(p.decel)} · swingMs ${p.swing}${p.ambiguous ? ' · 애매' : ''}`,
    });
  };

  const onClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const { best } = nearest(ev);
    if (best) onPick(best.p.stick, best.p.seq);
  };

  const summary = ([0, 1] as const).map((stick) => {
    const xs = points.filter((p) => p.stick === stick);
    const vel = xs.map((p) => p.vel);
    const peak = xs.map((p) => p.peak);
    return {
      stick,
      n: xs.length,
      velMed: median(vel),
      peakMed: median(peak),
      rho: xs.length >= MIN_CORR_N ? spearman(peak, vel) : null,
    };
  });

  return (
    <div className="mon-trend-panel">
      <div className="mon-summary-line">
        가로축{' '}
        {AXES.map((a) => (
          <button key={a.key} className={axis === a.key ? 'btn-primary small' : 'btn-ghost small'} onClick={() => setAxis(a.key)}>
            {a.label}
          </button>
        ))}
        <span className="faint"> 세기 산점 · 최근 {MAX_POINTS}건</span>
      </div>
      {summary.map((s) => (
        <div key={s.stick} className="mon-summary-line">
          <strong style={{ color: s.stick === 0 ? 'var(--left)' : 'var(--right)' }}>{stickName(s.stick)}</strong> n {s.n} · velocity 중앙값{' '}
          {fmt(s.velMed, 0)} · peakSpeed 중앙값 {fmt(s.peakMed, 0)} · 스피어만 상관{' '}
          <span className={s.rho !== null && s.rho < CORR_WARN ? 'warn' : ''}>{fmt(s.rho, 2)}</span>
          {s.rho !== null && s.rho < CORR_WARN && <span className="warn"> (세기가 속도를 안 따라감?)</span>}
        </div>
      ))}
      <div className="mon-plane-canvas">
        <canvas
          ref={ref}
          className="mon-trend-cv"
          onMouseMove={onMove}
          onMouseLeave={() => setTip(null)}
          onClick={onClick}
          style={{ cursor: tip ? 'pointer' : 'default' }}
        />
        {tip && (
          <div className="mon-plane-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
            {tip.text}
          </div>
        )}
      </div>
      <div className="faint small">
        점 색 = 스틱(L 파랑·R 주황) · 속 빈 원 = 판정 애매(ambiguous) · 바깥 테두리 = 최근 {RECENT}건 · 점 클릭 → HIT 탭 해당 행 · 상관은 표본{' '}
        {MIN_CORR_N}건부터 계산. 모의 스틱의 velocity 곡선은 검증용 가정이며 펌웨어 곡선이 아닙니다.
      </div>
    </div>
  );
});
