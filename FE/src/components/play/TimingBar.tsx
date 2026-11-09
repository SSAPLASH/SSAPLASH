// 타이밍 오차 막대(설계 3-5) — 판정 창(±goodMs) 폭의 가로 막대. 왼쪽 빠름·오른쪽 늦음, 가운데 0.
// 눈금은 이벤트 소스(판정된 타격)에서 직접 받아 쌓고(React state 없음), 눈금이 살아 있는 동안만 rAF를 돈다.
// 판정 범위 밖 타격(missSource)은 막대 양 끝 바깥에 MISS 색 점으로 보인다(설계 MODE-003-timing-bar-miss-dot).
import { useEffect, useRef } from 'react';
import type { FxSource } from '@/domain/hitFx/types';
import { addMissMark, addTimingMark, EMPTY_TIMING_BAR, hasLiveTicks, timingBarView, type MissSource, type TimingBarState } from '@/domain/hitFx/timingBar';
import { JUDGE_COLORS_FALLBACK } from '@/domain/hitFx/judgeFx';
import { readJudgeColors } from '@/components/fx/judgeColors';
import './TimingBar.css';

/** 막대 폭(판정 창 ±goodMs) */
export const TIMING_BAR_W = 240;
export const TIMING_BAR_H = 14;
/** 막대 좌우 바깥 범위 밖 점 자리 */
export const TIMING_BAR_MISS_GUTTER = 12;
/** 캔버스 폭 = 막대 + 양쪽 점 자리 */
export const TIMING_BAR_CANVAS_W = TIMING_BAR_W + TIMING_BAR_MISS_GUTTER * 2;

export interface TimingBarProps {
  /** 판정된 타격 이벤트(deltaMs 포함)를 내는 소스. 하이웨이·악보 이펙트와 같은 것을 쓴다 */
  source: FxSource;
  /** 판정 창(ms). 막대 폭은 ±goodMs, 하늘 띠는 ±perfectMs */
  perfectMs: number;
  goodMs: number;
  /** 값이 바뀌면 눈금을 비운다(새 판·다시 시작) */
  resetToken?: unknown;
  /** 판정 범위 밖 타격(타격 − 가까운 노트 ms). 없으면 바깥 점을 그리지 않는다 */
  missSource?: MissSource;
}

export function TimingBar({ source, perfectMs, goodMs, resetToken, missSource }: TimingBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const win = useRef({ perfectMs, goodMs });
  useEffect(() => {
    win.current = { perfectMs, goodMs };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !ctx) return;
    // resetToken이 바뀔 때마다 이 effect가 다시 돌아 상태가 비워진다
    void resetToken;
    const colors = (() => {
      try {
        return readJudgeColors(canvas);
      } catch {
        return { ...JUDGE_COLORS_FALLBACK };
      }
    })();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(TIMING_BAR_CANVAS_W * dpr);
    canvas.height = Math.round(TIMING_BAR_H * dpr);
    let state: TimingBarState = EMPTY_TIMING_BAR;
    let raf = 0;

    const draw = () => {
      raf = 0;
      const now = performance.now();
      const { perfectMs: pm, goodMs: gm } = win.current;
      const view = timingBarView(state, now, gm);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, TIMING_BAR_CANVAS_W, TIMING_BAR_H);
      const half = TIMING_BAR_W / 2;
      const barTop = 2;
      const barH = 8;
      // 범위 밖 점: 막대 끝에서 바깥으로 6px, 지름 6
      for (const m of view.misses) {
        ctx.globalAlpha = m.alpha;
        ctx.fillStyle = colors.miss;
        ctx.beginPath();
        ctx.arc(m.side < 0 ? TIMING_BAR_MISS_GUTTER - 6 : TIMING_BAR_MISS_GUTTER + TIMING_BAR_W + 6, barTop + barH / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // 이 아래는 막대 좌표(막대 왼쪽 끝 = 0)
      ctx.setTransform(dpr, 0, 0, dpr, TIMING_BAR_MISS_GUTTER * dpr, 0);
      // 바깥 창(GOOD 색 옅게) → 안쪽(PERFECT 색 옅게) → 가운데 0선
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = colors.good;
      ctx.fillRect(0, barTop, TIMING_BAR_W, barH);
      ctx.fillStyle = colors.perfect;
      const pw = Math.min(1, pm / (gm > 0 ? gm : 1)) * half;
      ctx.fillRect(half - pw, barTop, pw * 2, barH);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = colors.perfect;
      ctx.fillRect(half - 0.5, barTop - 1, 1, barH + 2);
      // 눈금: 판정 색 2px 세로선, 시간이 지나며 옅어진다
      for (const t of view.ticks) {
        ctx.globalAlpha = t.alpha;
        ctx.fillStyle = t.judgement === 'PERFECT' ? colors.perfect : colors.good;
        ctx.fillRect(half + t.pos * half - 1, barTop - 2, 2, barH + 4);
      }
      // 최근 10타 평균: 아래쪽 작은 삼각형
      if (view.avgPos !== null) {
        const ax = half + view.avgPos * half;
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(ax, barTop + barH + 0.5);
        ctx.lineTo(ax - 3.5, TIMING_BAR_H);
        ctx.lineTo(ax + 3.5, TIMING_BAR_H);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (hasLiveTicks(state, now)) raf = requestAnimationFrame(draw);
    };
    draw();

    const off = source((e) => {
      const next = addTimingMark(state, { deltaMs: e.deltaMs, judgement: e.judgement, at: performance.now() });
      if (next === state) return;
      state = next;
      if (raf === 0) raf = requestAnimationFrame(draw);
    });
    const offMiss = missSource?.((deltaMs) => {
      const next = addMissMark(state, { deltaMs, at: performance.now() });
      if (next === state) return;
      state = next;
      if (raf === 0) raf = requestAnimationFrame(draw);
    });
    return () => {
      off();
      offMiss?.();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [source, missSource, resetToken]);

  return <canvas ref={canvasRef} className="timing-bar" width={TIMING_BAR_CANVAS_W} height={TIMING_BAR_H} aria-hidden="true" />;
}
