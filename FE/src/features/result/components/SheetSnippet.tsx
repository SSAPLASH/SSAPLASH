// 약점 마디 미니 악보 — 결과 페이지용 정지 화면. 마운트·props 변경·리사이즈 때만 그린다(rAF 없음).
import { useEffect, useRef } from 'react';
import type { Judgement } from '@/domain/play/judgement';
import { gridOriginMs, layoutBar, SHEET_BAR_PX, songTimeAtGrid, type BarLayout, type GridChart } from '@/domain/song/sheet';
import { drawSheet, readColors } from '@/components/sheetmusic/sheetStripDraw';

export interface SheetSnippetProps {
  chart: GridChart;
  /** chart.notes와 같은 인덱스. 미판정은 null */
  noteStates: (Judgement | null)[];
  /** 그릴 마디 범위(0부터, 양쪽 포함) */
  bars: [number, number];
}

/** 마디선·번호 글자가 잘리지 않게 두는 좌우 여백(px) */
const PAD_X = 8;
const MIN_BAR_PX = 180;

export function SheetSnippet({ chart, noteStates, bars }: SheetSnippetProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const colors = readColors(canvas);
    // 마디 배치 캐시(리사이즈로 다시 그릴 때 재사용). 범위가 몇 마디뿐이라 effect마다 새로 만들어도 된다
    const cache = new Map<number, BarLayout>();
    const beatMs = 60_000 / chart.bpm;
    const barMs = beatMs * chart.beatsPerBar;
    const stepsPerBar = chart.beatsPerBar * 4;
    const originMs = gridOriginMs(chart);
    const layoutOf = (bar: number) => {
      let l = cache.get(bar);
      if (!l) {
        l = layoutBar(chart, bar, { stepsPerBar });
        cache.set(bar, l);
      }
      return l;
    };

    const paint = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const count = bars[1] - bars[0] + 1;
      const inner = Math.max(0, width - PAD_X * 2);
      const barPx = Math.min(SHEET_BAR_PX, Math.max(MIN_BAR_PX, inner / count));
      // 첫 마디 왼쪽이 좌측 여백(x = PAD_X)에 오도록 기준선을 옮긴다
      drawSheet(ctx, {
        chart,
        noteStates,
        strayHits: [],
        songTime: songTimeAtGrid(chart, bars[0] * barMs),
        originMs,
        width,
        height,
        barPx,
        baseRatio: PAD_X / Math.max(1, width),
        colors,
        layoutOf,
        bars: { first: bars[0], last: bars[1] },
        barMs,
        beatMs,
        showBase: false,
      });
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [chart, noteStates, bars]);

  return (
    <div ref={wrapRef} className="sheet-snippet">
      <canvas ref={canvasRef} className="sheet-strip-canvas" />
    </div>
  );
}
