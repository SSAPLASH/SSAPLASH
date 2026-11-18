// ⑤ 채점 N: delta 히스토그램. 이번 세션의 delta(타격 − 노트, +면 늦음)를 구간별 막대로 그리고
// PERFECT·GOOD 판정 창을 띠로 겹쳐 보인다. 평균이 한쪽으로 치우쳐 있으면 계통 오차(오디오 오프셋·지연)를 의심한다.
import { useEffect, useRef } from 'react';
import type { TimingWindows } from '@/domain/play/judgement';
import { cssVar, fmt, prepareCanvas } from './monitorTypes';

const BIN_MS = 5;
const PAD_L = 30;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 20;

export function DeltaHistogram({
  deltas,
  windows,
  tick,
}: {
  /** 이번 세션의 delta 전부(ms) */
  deltas: readonly number[];
  /** 세션의 판정 창. 모르면 null(띠 없이 막대만) */
  windows: TimingWindows | null;
  /** 100ms 스냅샷 번호. 바뀔 때 다시 그린다 */
  tick: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    const c = prepareCanvas(el);
    if (!c || !el) return;
    const { ctx, w, h } = c;
    const line = cssVar(el, '--line', '#34405c');
    const faint = cssVar(el, '--text-3', '#6e778d');
    const ink = cssVar(el, '--text-1', '#e8ecf5');
    const brass = cssVar(el, '--brand', '#d4a24c');
    const good = cssVar(el, '--good', '#5fb8ae');
    const perfect = cssVar(el, '--perfect', '#e0b84c');

    // 가로 범위: 판정 창의 1.5배(없으면 90ms)와 실제 값 중 큰 쪽, 구간 폭의 배수로 맞춘다
    const reach = Math.max(windows ? windows.goodMs * 1.5 : 90, ...deltas.map((d) => Math.abs(d)));
    const half = Math.ceil(reach / BIN_MS) * BIN_MS;
    const bins = (half * 2) / BIN_MS;
    const counts = new Array<number>(bins).fill(0);
    for (const d of deltas) counts[Math.min(bins - 1, Math.max(0, Math.floor((d + half) / BIN_MS)))] += 1;
    const yMax = Math.max(4, ...counts);

    const plotW = w - PAD_L - PAD_R;
    const plotH = h - PAD_T - PAD_B;
    const xOf = (ms: number) => PAD_L + ((ms + half) / (half * 2)) * plotW;
    const yOf = (n: number) => PAD_T + plotH - (n / yMax) * plotH;

    // 판정 창 띠: GOOD 바깥쪽 옅게, PERFECT 안쪽 조금 더 진하게
    if (windows) {
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = good;
      ctx.fillRect(xOf(-windows.goodMs), PAD_T, xOf(windows.goodMs) - xOf(-windows.goodMs), plotH);
      ctx.fillStyle = perfect;
      ctx.fillRect(xOf(-windows.perfectMs), PAD_T, xOf(windows.perfectMs) - xOf(-windows.perfectMs), plotH);
      ctx.globalAlpha = 1;
    }

    ctx.font = '10px monospace';
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_L + 0.5, PAD_T + 0.5, plotW - 1, plotH - 1);

    // 막대
    ctx.fillStyle = brass;
    ctx.globalAlpha = 0.85;
    const bw = plotW / bins;
    counts.forEach((n, i) => {
      if (n === 0) return;
      ctx.fillRect(PAD_L + i * bw + 1, yOf(n), Math.max(1, bw - 2), PAD_T + plotH - yOf(n));
    });
    ctx.globalAlpha = 1;

    // 0 기준선과 가로 눈금
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(xOf(0), PAD_T);
    ctx.lineTo(xOf(0), PAD_T + plotH);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = faint;
    ctx.textAlign = 'center';
    const step = half > 60 ? 30 : 20;
    for (let v = -Math.floor(half / step) * step; v <= half; v += step) ctx.fillText(String(v), xOf(v), h - 6);
    ctx.textAlign = 'right';
    ctx.fillText('0', PAD_L - 4, PAD_T + plotH);
    ctx.fillText(String(yMax), PAD_L - 4, PAD_T + 9);

    // 평균 표시
    if (deltas.length > 0) {
      const mean = deltas.reduce((a, v) => a + v, 0) / deltas.length;
      ctx.strokeStyle = perfect;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xOf(mean), PAD_T);
      ctx.lineTo(xOf(mean), PAD_T + plotH);
      ctx.stroke();
    }
  }, [deltas, windows, tick]);

  const mean = deltas.length ? deltas.reduce((a, v) => a + v, 0) / deltas.length : null;
  return (
    <div className="mon-trend-panel">
      <div className="mon-summary-line">
        이번 세션 {deltas.length}판정 · 평균 {mean === null ? '–' : `${mean >= 0 ? '+' : ''}${fmt(mean)}`}ms{' '}
        <span className="faint">(구간 {BIN_MS}ms)</span>
      </div>
      <canvas ref={ref} className="mon-trend-cv mon-hist-cv" />
      <div className="faint small">
        가로 = delta(ms, +면 늦음) · 세로 = 건수 · 옅은 띠 = 판정 창(안쪽 PERFECT·바깥 GOOD) · 노란 세로선 = 평균. 평균이 0에서
        벗어나 있으면 계통 오차입니다.
      </div>
    </div>
  );
}
