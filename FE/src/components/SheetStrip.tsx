// 악보 스트립 — 채보를 5선 드럼 악보로 가로로 흘려 그린다 (Canvas 2D). 고정 기준선이 지금 칠 위치.
import { useEffect, useMemo, useRef } from 'react';
import type { Chart } from '@/domain/chart';
import type { Judgement } from '@/domain/judgement';
import { buildSheet, layoutBar, SHEET_BAR_PX, SHEET_BASE_RATIO, type BarLayout } from '@/domain/sheet';
import { drawSheet, readColors } from './sheetStripDraw';
import { snapToBar, visibleBars } from './sheetStripMath';

export interface SheetStripProps {
  chart: Chart;
  /** chart.notes와 같은 인덱스. 미판정은 null */
  noteStates: (Judgement | null)[];
  /** 채보 밖 타격(곡 시각 ms) */
  strayHits: { timeMs: number }[];
  /** 매 프레임 호출된다(React 재렌더 없이). null이면 0 기준 정지 */
  getSongTime: () => number | null;
  barPx?: number;
  baseRatio?: number;
  /** 카운트인 길이(ms). 주어지면 이 구간에서만 남은 박 수를 보인다 */
  countInMs?: number;
}

export function SheetStrip({
  chart,
  noteStates,
  strayHits,
  getSongTime,
  barPx = SHEET_BAR_PX,
  baseRatio = SHEET_BASE_RATIO,
  countInMs,
}: SheetStripProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 최신 props를 그리기 루프에 넘긴다 (렌더 중 ref 쓰기 회피)
  const live = useRef({ noteStates, strayHits, getSongTime, barPx, baseRatio, countInMs });
  useEffect(() => {
    live.current = { noteStates, strayHits, getSongTime, barPx, baseRatio, countInMs };
  });

  // chart가 바뀔 때만 마디 배치를 새로 만든다 (마디별 지연 계산 캐시)
  const model = useMemo(
    () => ({ sheet: buildSheet(chart, chart.beatsPerBar * 4), cache: new Map<number, BarLayout>() }),
    [chart],
  );

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const colors = readColors();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const { sheet, cache } = model;
    const barMs = sheet.barMs;
    const totalBars = sheet.bars.length;
    let width = wrap.clientWidth;
    let height = wrap.clientHeight;
    const ro = new ResizeObserver(() => {
      width = wrap.clientWidth;
      height = wrap.clientHeight;
    });
    ro.observe(wrap);

    const layoutOf = (bar: number) => {
      let l = cache.get(bar);
      if (!l) {
        l = layoutBar(chart, bar, { stepsPerBar: sheet.stepsPerBar });
        cache.set(bar, l);
      }
      return l;
    };

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const p = live.current;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const raw = p.getSongTime() ?? 0;
      const t = reduced ? snapToBar(raw, barMs) : raw;
      drawSheet(ctx, {
        chart,
        noteStates: p.noteStates,
        strayHits: p.strayHits,
        songTime: t,
        rawSongTime: raw,
        width,
        height,
        barPx: p.barPx,
        baseRatio: p.baseRatio,
        colors,
        layoutOf,
        bars: visibleBars(t, width, p.barPx, p.baseRatio, barMs, totalBars),
        barMs,
        beatMs: sheet.beatMs,
        showBase: true,
        countInMs: p.countInMs,
      });
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [chart, model]);

  return (
    <div ref={wrapRef} className="sheet-strip">
      <canvas ref={canvasRef} className="sheet-strip-canvas" />
    </div>
  );
}
