// 추이·분포 탭 왼쪽: 시계 동기화 추이. 위 패널은 관측 오프셋(점)과 채택 오프셋(계단선), 아래 패널은 왕복 rtt(점)와
// 1초 창 POSE 유실률(회색 막대). 계산(기울기·중앙값)은 monitor/syncTrend, 여기는 그리기와 표시만 한다.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { SyncSample } from '@/features/monitor/core/recording/packetLog';
import { type LossHistory, median, slopeMsPerMin } from '@/features/monitor/core/syncTrend';
import { cssVar, fmt, prepareCanvas, stickName, type Snap } from './monitorTypes';

const SPANS = [
  { ms: 120_000, label: '120초' },
  { ms: 600_000, label: '10분' },
];
const PAD_L = 46;
const PAD_R = 38;
const MIN_HALF_MS = 5;
const MIN_LOSS_AXIS_PCT = 5;
/** 기울기 절댓값이 이 값(ms/분)을 넘으면 노랑 */
const SLOPE_WARN = 1;
const HOVER_PX = 14;

interface HitPoint {
  x: number;
  y: number;
  s: SyncSample;
}

export const SyncScope = memo(function SyncScope({ snap, loss }: { snap: Snap; loss: LossHistory }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hits = useRef<HitPoint[]>([]);
  const [spanMs, setSpanMs] = useState(SPANS[0].ms);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const sync = snap.stats.sync;

  // 표시 구간의 표본
  const windowed = useMemo(() => {
    const from = snap.now - spanMs;
    return sync.samples.filter((s) => s.t >= from);
  }, [sync.samples, snap.now, spanMs]);

  useEffect(() => {
    const el = ref.current;
    const c = prepareCanvas(el);
    if (!c || !el) return;
    const { ctx, w, h } = c;
    const colors = [cssVar(el, '--left', '#7cc4ff'), cssVar(el, '--right', '#ffa07c')];
    const line = cssVar(el, '--line', '#34405c');
    const faint = cssVar(el, '--text-3', '#6e778d');
    const from = snap.now - spanMs;
    const plotW = w - PAD_L - PAD_R;
    const xOf = (t: number) => PAD_L + ((t - from) / spanMs) * plotW;
    const top = { y0: 6, y1: Math.round(h * 0.5) - 8 };
    const bot = { y0: Math.round(h * 0.5) + 6, y1: h - 18 };
    const found: HitPoint[] = [];

    ctx.font = '10px monospace';
    for (const p of [top, bot]) {
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD_L + 0.5, p.y0 + 0.5, plotW - 1, p.y1 - p.y0 - 1);
    }
    // 가로축 눈금(오른쪽 끝 = 지금)
    ctx.fillStyle = faint;
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const t = from + (spanMs * i) / 4;
      const label = i === 4 ? '지금' : `-${Math.round((snap.now - t) / 1000)}s`;
      ctx.fillText(label, xOf(t), h - 5);
    }
    ctx.textAlign = 'start';

    // --- 위: 관측 오프셋 + 채택 오프셋 ---
    const obs = windowed.map((s) => s.offsetObsMs);
    const adopted = sync.adopted;
    if (obs.length === 0) {
      ctx.fillStyle = faint;
      ctx.fillText('관측 오프셋 없음 (SYNC 왕복 대기)', PAD_L + 8, top.y0 + 16);
    } else {
      const center = median(obs) ?? 0;
      const dev = Math.max(...obs.map((o) => Math.abs(o - center)));
      const half = Math.max(dev * 1.1, MIN_HALF_MS);
      const yOf = (v: number) => top.y1 - ((v - (center - half)) / (2 * half)) * (top.y1 - top.y0);
      ctx.fillStyle = faint;
      ctx.strokeStyle = line;
      // 오프셋 절대값은 스틱 가동 시간만큼 커서(수백만 ms) 왼쪽 여백에 안 들어간다 — 눈금은 중앙값 기준 상대값으로
      for (const v of [center + half, center, center - half]) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(PAD_L, yOf(v));
        ctx.lineTo(w - PAD_R, yOf(v));
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.textAlign = 'right';
        const rel = v - center;
        ctx.fillText(`${rel > 0 ? '+' : ''}${rel.toFixed(1)}`, PAD_L - 4, yOf(v) + 3);
      }
      ctx.textAlign = 'start';
      ctx.fillText(`오프셋 ms, 중앙값 ${center.toFixed(1)} 기준 (관측 점 · 채택 계단선)`, PAD_L + 6, top.y0 + 11);

      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD_L, top.y0, plotW, top.y1 - top.y0);
      ctx.clip();
      // 채택 계단선: 창 시작 이전의 마지막 값에서 이어 그린다
      for (const stick of [0, 1] as const) {
        const list = adopted.filter((a) => a.stick === stick);
        if (list.length === 0) continue;
        let before: number | null = null;
        const inside: typeof list = [];
        for (const a of list) {
          if (a.t < from) before = a.offsetMs;
          else inside.push(a);
        }
        let cur = before ?? inside[0]?.offsetMs ?? null;
        if (cur === null) continue;
        ctx.strokeStyle = colors[stick];
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(xOf(before === null ? inside[0].t : from), yOf(cur));
        for (const a of inside) {
          ctx.lineTo(xOf(a.t), yOf(cur));
          ctx.lineTo(xOf(a.t), yOf(a.offsetMs));
          cur = a.offsetMs;
        }
        ctx.lineTo(xOf(snap.now), yOf(cur));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const s of windowed) {
        const x = xOf(s.t);
        const y = yOf(s.offsetObsMs);
        ctx.fillStyle = colors[s.stick];
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        found.push({ x, y, s });
      }
      ctx.restore();
    }

    // --- 아래: rtt 점 + POSE 유실률 막대(오른쪽 축 %) ---
    const lossPts = loss.since(from);
    const lossMax = Math.max(
      MIN_LOSS_AXIS_PCT,
      ...lossPts.map((p) => Math.max(p.pct[0] ?? 0, p.pct[1] ?? 0)),
    );
    const rttMax = Math.max(5, ...windowed.map((s) => s.rttMs)) * 1.1;
    const yRtt = (v: number) => bot.y1 - (v / rttMax) * (bot.y1 - bot.y0);
    ctx.fillStyle = faint;
    ctx.textAlign = 'right';
    ctx.fillText(rttMax.toFixed(0), PAD_L - 4, bot.y0 + 8);
    ctx.fillText('0', PAD_L - 4, bot.y1);
    ctx.textAlign = 'start';
    ctx.fillText(`${lossMax.toFixed(0)}%`, w - PAD_R + 4, bot.y0 + 8);
    ctx.fillText('0%', w - PAD_R + 4, bot.y1);
    ctx.fillText('rtt ms (점) · POSE 유실률 % (회색 막대, 오른쪽 축)', PAD_L + 6, bot.y0 + 11);
    const barW = Math.max(1, (1000 / spanMs) * plotW);
    ctx.fillStyle = faint;
    ctx.globalAlpha = 0.35;
    for (const p of lossPts) {
      const pct = Math.max(p.pct[0] ?? 0, p.pct[1] ?? 0);
      if (pct <= 0) continue;
      const bh = (pct / lossMax) * (bot.y1 - bot.y0);
      ctx.fillRect(xOf(p.t) - barW, bot.y1 - bh, barW, bh);
    }
    ctx.globalAlpha = 1;
    for (const s of windowed) {
      const x = xOf(s.t);
      const y = yRtt(s.rttMs);
      ctx.fillStyle = colors[s.stick];
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      found.push({ x, y, s });
    }
    hits.current = found;
  }, [snap, spanMs, windowed, sync.adopted, loss]);

  // 호버: 가장 가까운 표본(두 패널 점 모두 대상)
  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    let best: HitPoint | null = null;
    let bd = HOVER_PX;
    for (const p of hits.current) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d <= bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) {
      setTip(null);
      return;
    }
    const s = best.s;
    setTip({
      x: cx,
      y: cy,
      text: `${stickName(s.stick)} · t0 ${fmt(s.t0)} · t1 ${fmt(s.t1Ms)} · t2 ${fmt(s.t)} · rtt ${fmt(s.rttMs)}ms · offset ${fmt(s.offsetObsMs, 2)}ms`,
    });
  };

  const perStick = ([0, 1] as const).map((stick) => {
    const xs = windowed.filter((s) => s.stick === stick);
    const rtts = xs.map((s) => s.rttMs);
    return {
      stick,
      n: xs.length,
      med: median(xs.map((s) => s.offsetObsMs)),
      slope: slopeMsPerMin(xs),
      rttMed: median(rtts),
      rttMin: rtts.length ? Math.min(...rtts) : null,
    };
  });
  // 모든 ACK의 t0가 짝을 못 찾으면 되돌림 자체가 어긋난 것이다(U19) — FIFO로 숨기지 않고 알린다
  const mismatch = sync.count > 0 && sync.unmatched === sync.count;

  return (
    <div className="mon-trend-panel">
      <div className="mon-summary-line">
        {SPANS.map((sp) => (
          <button
            key={sp.ms}
            className={spanMs === sp.ms ? 'btn-primary small' : 'btn-ghost small'}
            onClick={() => setSpanMs(sp.ms)}
          >
            {sp.label}
          </button>
        ))}
        <span className="faint"> 동기화 추이 · 점 = 관측(L 파랑·R 주황), 선 = 채택 오프셋</span>
      </div>
      {perStick.map((p) => (
        <div key={p.stick} className="mon-summary-line">
          <strong style={{ color: p.stick === 0 ? 'var(--left)' : 'var(--right)' }}>{stickName(p.stick)}</strong> 관측 오프셋 중앙값{' '}
          {fmt(p.med, 2)}ms · 기울기{' '}
          <span className={p.slope !== null && Math.abs(p.slope) > SLOPE_WARN ? 'warn' : ''}>{fmt(p.slope, 2)}</span>ms/분 · rtt 중앙값/최소{' '}
          {fmt(p.rttMed)}/{fmt(p.rttMin)}ms · 표본 {p.n}
        </div>
      ))}
      <div className="mon-summary-line">
        짝 실패 {sync.unmatched}건 / ACK {sync.count}건
        {mismatch && <span className="bad"> — t0 되돌림 불일치(짝이 하나도 안 맞음). 펌웨어·브리지가 t0를 그대로 돌려주는지 확인</span>}
      </div>
      <div className="mon-plane-canvas">
        <canvas ref={ref} className="mon-trend-cv" onMouseMove={onMove} onMouseLeave={() => setTip(null)} />
        {tip && (
          <div className="mon-plane-tip" style={{ left: Math.min(tip.x + 12, 9999), top: tip.y + 12 }}>
            {tip.text}
          </div>
        )}
      </div>
      <div className="faint small">
        관측 점이 한 방향으로 흐르는데 계단선이 그대로면 시계 드리프트를 ClockSync가 못 따라가는 것이고, 위아래로 흩어지면 왕복 지연 변동입니다.
        기울기 절댓값이 {SLOPE_WARN}ms/분을 넘으면 노랑입니다. 소스가 없는 모의 스틱은 채택 계단선이 없습니다.
      </div>
    </div>
  );
});
