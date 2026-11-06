// 악보 페이저 — 마디를 화면에 고정하고 커서가 왼쪽에서 오른쪽으로 움직인다 (Canvas 2D).
// 슬롯마다 drawSheet를 한 번씩 clip해서 부르고, 커서가 지나간 슬롯은 1박 뒤 다음 페이지 마디로 바꿔 끼운다.
// 슬롯·커서·박 라벨은 격자 시각(곡 시각 − chart.offsetMs)으로 계산한다. 격자 시각이 0보다 작으면(카운트인·인트로) 커서는 첫 슬롯 왼쪽에 선다.
import { useEffect, useMemo, useRef } from 'react';
import type { Chart } from '@/domain/chart';
import type { Judgement } from '@/domain/judgement';
import { buildSheet, gridTimeOf, layoutBar, type BarLayout } from '@/domain/sheet';
import { barsPerPage, cursorPos, pagerSlots, snapToBeat } from './sheetPagerMath';
import { xInBar } from './sheetStripMath';
import { drawBeatLabel, drawCursor, drawSheet, readColors, STAFF_BOTTOM_Y, STAFF_TOP_Y } from './sheetStripDraw';

export interface SheetPagerProps {
  chart: Chart;
  /** chart.notes와 같은 인덱스. 미판정은 null */
  noteStates: (Judgement | null)[];
  /** 채보 밖 타격(곡 시각 ms) */
  strayHits: { timeMs: number }[];
  /** 매 프레임 호출된다(React 재렌더 없이). null이면 0 기준 정지 */
  getSongTime: () => number | null;
  /** 카운트인 길이(ms). 주어지면 이 구간에서만 남은 박 수를 보인다 */
  countInMs?: number;
  openWarnings?: React.RefObject<Map<number, number>>;
}

/** 마디 왼쪽 선·번호가 잘리지 않도록 clip 왼쪽에 두는 여유(px) */
const CLIP_PAD = 2;
/** 왼쪽 여백(px). 첫 마디 앞 박자표(drawSheet가 마디 왼쪽 22px에 그린다)가 잘리지 않게 둔다 */
const GUTTER_X = 44;
/** 보표·커서·박 번호가 차지하는 세로 범위(px). 캔버스가 더 높으면 이만큼을 세로 가운데에 놓는다 */
const CONTENT_TOP = STAFF_TOP_Y - 46;
const CONTENT_BOTTOM = STAFF_BOTTOM_Y + 56;

export function SheetPager({ chart, noteStates, strayHits, getSongTime, countInMs, openWarnings }: SheetPagerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 최신 props를 그리기 루프에 넘긴다 (렌더 중 ref 쓰기 회피)
  const live = useRef({ noteStates, strayHits, getSongTime, countInMs });
  useEffect(() => {
    live.current = { noteStates, strayHits, getSongTime, countInMs };
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
    const colors = readColors(canvas);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const { sheet, cache } = model;
    const { barMs, beatMs, originMs } = sheet;
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
      const nowMs = performance.now();
      for (const [index, expiry] of openWarnings?.current ?? []) if (expiry <= nowMs) openWarnings?.current.delete(index);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      // 세로 가운데 정렬. 가로는 슬롯 x에 왼쪽 여백을 더한다(보표 선은 drawSheet가 전체 폭에 긋는다)
      const offsetY = Math.max(0, (height - (CONTENT_BOTTOM - CONTENT_TOP)) / 2 - CONTENT_TOP);
      ctx.translate(0, offsetY);
      const inner = Math.max(1, width - GUTTER_X);

      const raw = p.getSongTime() ?? 0;
      const grid = gridTimeOf(raw, originMs);
      const t = reduced ? snapToBeat(grid, beatMs) : grid;
      const perPage = barsPerPage(inner);
      const slotW = inner / perPage;
      const slots = pagerSlots(t, barMs, beatMs, perPage, totalBars);

      slots.forEach((slot, i) => {
        if (slot.bar === null) return;
        ctx.save();
        ctx.beginPath();
        // 첫 슬롯은 캔버스 왼쪽 끝이라 여유가 필요 없다
        // 첫 슬롯은 왼쪽 여백(박자표 자리)까지 포함한다
        const slotX = GUTTER_X + i * slotW;
        const clipLeft = i === 0 ? 0 : slotX - CLIP_PAD;
        ctx.rect(clipLeft, -offsetY, slotX + slotW - clipLeft, height);
        ctx.clip();
        if (slot.upcoming) ctx.globalAlpha = 0.35;
        drawSheet(ctx, {
          chart,
          noteStates: p.noteStates,
          strayHits: p.strayHits,
          songTime: originMs + slot.bar * barMs,
          rawSongTime: raw,
          originMs,
          width,
          height,
          barPx: slotW,
          baseRatio: slotX / width,
          colors,
          layoutOf,
          bars: { first: slot.bar, last: slot.bar },
          barMs,
          beatMs,
          showBase: false,
          countInMs: p.countInMs,
          openWarnings: openWarnings?.current,
          nowMs,
        });
        ctx.restore();
      });

      const { slot, ratio } = cursorPos(t, barMs, perPage);
      const x = xInBar(GUTTER_X + slot * slotW, slotW, ratio); // 노트 시각에 그 머리 중심을 지난다
      drawCursor(ctx, x, STAFF_TOP_Y - 30, STAFF_BOTTOM_Y + 40, colors);
      drawBeatLabel(ctx, x + 12, STAFF_BOTTOM_Y + 46, grid, beatMs, chart.beatsPerBar, colors, p.countInMs);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [chart, model, openWarnings]);

  return (
    <div ref={wrapRef} className="sheet-pager">
      <canvas ref={canvasRef} className="sheet-strip-canvas" />
    </div>
  );
}
