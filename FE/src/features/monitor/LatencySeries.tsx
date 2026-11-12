// ⑥ 출력 N: 구간 지연 시계열. 타격마다 센서→수신·수신→판정·판정→오디오를 누적 막대로 쌓아 어느 구간이 늘었는지 본다.
import { useEffect, useRef } from 'react';
import { HEALTH_THRESHOLDS } from '@/features/monitor/core/health';
import type { LatencyPoint } from '@/features/monitor/core/latencyStats';
import { cssVar, prepareCanvas } from './monitorTypes';

const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 16;

export function LatencySeries({ points, tick }: { points: readonly LatencyPoint[]; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    const c = prepareCanvas(el);
    if (!c || !el) return;
    const { ctx, w, h } = c;
    const line = cssVar(el, '--line', '#34405c');
    const faint = cssVar(el, '--text-3', '#6e778d');
    const colors = [cssVar(el, '--left', '#7cc4ff'), cssVar(el, '--brand', '#d4a24c'), cssVar(el, '--right', '#ffa07c')];
    const miss = cssVar(el, '--miss', '#e05a5a');

    // 구간 값이 음수(시계 어긋남)여도 막대는 0부터 쌓는다
    const total = (p: LatencyPoint) => Math.max(0, p.recv) + Math.max(0, p.resolve) + Math.max(0, p.audio ?? 0);
    const limit = HEALTH_THRESHOLDS.output.totalP95WarnMs;
    const yMax = Math.max(limit * 1.25, ...points.map(total));
    const plotW = w - PAD_L - PAD_R;
    const plotH = h - PAD_T - PAD_B;
    const yOf = (v: number) => PAD_T + plotH - (v / yMax) * plotH;

    ctx.font = '10px monospace';
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_L + 0.5, PAD_T + 0.5, plotW - 1, plotH - 1);
    ctx.fillStyle = faint;
    ctx.textAlign = 'right';
    ctx.fillText('0', PAD_L - 4, PAD_T + plotH);
    ctx.fillText(yMax.toFixed(0), PAD_L - 4, PAD_T + 9);

    // 전체 p95 기준선
    ctx.strokeStyle = miss;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD_L, yOf(limit));
    ctx.lineTo(w - PAD_R, yOf(limit));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = miss;
    ctx.textAlign = 'left';
    ctx.fillText(`전체 p95 기준 ${limit}ms`, PAD_L + 4, yOf(limit) - 3);

    const n = points.length;
    if (n === 0) return;
    const slot = plotW / Math.max(n, 40);
    const bw = Math.max(1, slot - 1);
    points.forEach((p, i) => {
      const x = PAD_L + i * slot;
      let acc = 0;
      [p.recv, p.resolve, p.audio ?? 0].forEach((v, k) => {
        const len = Math.max(0, v);
        ctx.fillStyle = colors[k];
        ctx.fillRect(x, yOf(acc + len), bw, yOf(acc) - yOf(acc + len));
        acc += len;
      });
    });
  }, [points, tick]);

  return (
    <div className="mon-trend-panel">
      <div className="mon-summary-line">
        최근 {points.length}건 <span className="faint">(왼쪽이 오래된 타격)</span>
      </div>
      <canvas ref={ref} className="mon-trend-cv mon-latency-cv" />
      <div className="faint small">
        막대 = 타격 1건, 아래부터 센서→수신(파랑) · 수신→판정(황동) · 판정→오디오(주황). 오디오 예약이 없는 타격(tAudio 없음)은 앞의 두 구간만
        쌓입니다.
      </div>
    </div>
  );
}
