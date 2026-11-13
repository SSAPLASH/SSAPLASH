// ④ 판정 N: 세기 곡선. 스틱이 보낸 velocity(가로, 입력)와 FE가 쓴 velocity(세로, 출력)를 점으로 찍는다.
// 입력 = 같은 seq의 HIT 패킷, 출력 = ResolvedHit. 점선은 y = x 기준선일 뿐 펌웨어·FE 곡선을 가정하지 않는다.
import { memo, useEffect, useRef } from 'react';
import type { VelocityPair } from '@/features/monitor/core/recording/judgeLog';
import { cssVar, prepareCanvas } from './monitorTypes';

const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 8;
const PAD_B = 20;
const GRID = [32, 64, 96, 127];

export const VelocityCurve = memo(function VelocityCurve({ pairs }: { pairs: readonly VelocityPair[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    const c = prepareCanvas(el);
    if (!c || !el) return;
    const { ctx, w, h } = c;
    const colors = [cssVar(el, '--left', '#7cc4ff'), cssVar(el, '--right', '#ffa07c')];
    const line = cssVar(el, '--line', '#34405c');
    const faint = cssVar(el, '--text-3', '#6e778d');
    const plotW = w - PAD_L - PAD_R;
    const plotH = h - PAD_T - PAD_B;
    const xOf = (v: number) => PAD_L + (v / 127) * plotW;
    const yOf = (v: number) => PAD_T + plotH - (v / 127) * plotH;

    ctx.font = '10px monospace';
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_L + 0.5, PAD_T + 0.5, plotW - 1, plotH - 1);
    ctx.fillStyle = faint;
    ctx.textAlign = 'right';
    for (const v of GRID) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(PAD_L, yOf(v));
      ctx.lineTo(w - PAD_R, yOf(v));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(String(v), PAD_L - 4, yOf(v) + 3);
    }
    ctx.textAlign = 'center';
    for (const v of GRID) ctx.fillText(String(v), xOf(v), h - 6);
    ctx.textAlign = 'start';
    ctx.fillText('FE velocity (세로) × 스틱 velocity (가로)', PAD_L + 6, PAD_T + 11);

    // y = x 기준선
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(0));
    ctx.lineTo(xOf(127), yOf(127));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.8;
    for (const p of pairs) {
      ctx.fillStyle = colors[p.stick];
      ctx.beginPath();
      ctx.arc(xOf(p.stickVelocity), yOf(p.feVelocity), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [pairs]);

  return (
    <div className="mon-trend-panel">
      <div className="mon-summary-line">
        <span className="faint">짝을 찾은 최근 {pairs.length}건</span>
      </div>
      <canvas ref={ref} className="mon-trend-cv" />
      <div className="faint small">
        점 색 = 스틱(L 파랑·R 주황) · 점선 = y = x 기준선(곡선 가정 아님). 스틱 HIT 패킷(seq)을 찾지 못한 타격은 그리지 않습니다.
      </div>
    </div>
  );
});
