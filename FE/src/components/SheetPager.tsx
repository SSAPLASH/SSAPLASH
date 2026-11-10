// 악보 페이저 — 마디를 화면에 고정하고 커서가 왼쪽에서 오른쪽으로 움직인다 (Canvas 2D).
// 슬롯마다 drawSheet를 한 번씩 clip해서 부르고, 커서가 지나간 슬롯은 1박 뒤 다음 페이지 마디로 바꿔 끼운다.
// 슬롯·커서·박 라벨은 격자 시각(gridTimeAt: 빠르기 구간이 없으면 곡 시각 − chart.offsetMs, 있으면 박 번호 기준)으로 계산한다.
// 카운트다운이 켜져 있으면(countInMs > 0) 악보를 한 칸 오른쪽으로 밀어 첫 칸을 빈 준비 마디로 두고, 카운트다운이 끝나면 커서가
// 준비 마디를 지나 그대로 1마디로 들어간다(설계 MODE-001-lead-in-bars D20). 그보다 앞(카운트다운·인트로)은 커서가 첫 칸 왼쪽에 선다.
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { FxCanvas } from '@/components/fx/FxCanvas';
import type { FxEvent, FxLocation, FxSource } from '@/domain/hitFx/types';
import type { Chart } from '@/domain/chart';
import type { Judgement } from '@/domain/judgement';
import { buildSheet, gridTimeAt, layoutBar, songTimeAtGrid, type BarLayout } from '@/domain/sheet';
import { barsPerPage, cursorPos, noteHeadAt, pagerSlots, snapToBeat, type PagerSlot } from './sheetPagerMath';
import { xInBar } from './sheetStripMath';
import { drawBeatLabel, drawCursor, drawEmptyBar, drawSheet, HEAD_RX, HEAD_RY, headY, readColors, STAFF_BOTTOM_Y, STAFF_TOP_Y, type HitMark } from './sheetStripDraw';

export interface SheetPagerProps {
  chart: Chart;
  /** chart.notes와 같은 인덱스. 미판정은 null */
  noteStates: (Judgement | null)[];
  /** 채보 밖 타격(곡 시각 ms) */
  strayHits: { timeMs: number }[];
  /** 매 프레임 호출된다(React 재렌더 없이). null이면 0 기준 정지 */
  getSongTime: () => number | null;
  openWarnings?: React.RefObject<Map<number, number>>;
  /** 판정된 타격의 친 위치 눈금(PERFECT·GOOD). 보표 아래 판정 색 짧은 세로선으로 그린다 */
  hitMarks?: React.RefObject<HitMark[]>;
  /** 판정 이펙트 소스(PERFECT·GOOD 머리 고리, MISS 파편). 없으면 이펙트 캔버스를 만들지 않는다 */
  fxSource?: FxSource;
  /** 악보 영역 안쪽 아래 가운데에 얹는 것(타이밍 막대) */
  overlay?: ReactNode;
  /** 카운트인(준비 마디) 길이(ms). 0보다 크면 준비 마디 한 칸을 앞에 둔다 */
  countInMs?: number;
}

/** 마디 왼쪽 선·번호가 잘리지 않도록 clip 왼쪽에 두는 여유(px) */
const CLIP_PAD = 2;
/** 왼쪽 여백(px). 첫 마디 앞 박자표(drawSheet가 마디 왼쪽 22px에 그린다)가 잘리지 않게 둔다 */
const GUTTER_X = 44;
/** 보표·커서·박 번호가 차지하는 세로 범위(px). 캔버스가 더 높으면 이만큼을 세로 가운데에 놓는다 */
const CONTENT_TOP = STAFF_TOP_Y - 46;
const CONTENT_BOTTOM = STAFF_BOTTOM_Y + 56;

export function SheetPager({ chart, noteStates, strayHits, getSongTime, openWarnings, hitMarks, fxSource, overlay, countInMs = 0 }: SheetPagerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 최신 props를 그리기 루프에 넘긴다 (렌더 중 ref 쓰기 회피)
  const live = useRef({ noteStates, strayHits, getSongTime, countInMs });
  useEffect(() => {
    live.current = { noteStates, strayHits, getSongTime, countInMs };
  });

  // chart가 바뀔 때만 마디 배치를 새로 만든다 (마디별 지연 계산 캐시)
  const model = useMemo(() => {
    const sheet = buildSheet(chart, chart.beatsPerBar * 4);
    const cache = new Map<number, BarLayout>();
    const layoutOf = (bar: number) => {
      let l = cache.get(bar);
      if (!l) {
        l = layoutBar(chart, bar, { stepsPerBar: sheet.stepsPerBar });
        cache.set(bar, l);
      }
      return l;
    };
    return { sheet, layoutOf };
  }, [chart]);

  // 마지막으로 그린 프레임의 슬롯 배치. 이펙트 위치 찾기가 읽는다(그리기 루프가 매 프레임 갱신)
  const geom = useRef<{ slots: PagerSlot[]; slotW: number; offsetY: number }>({ slots: [], slotW: 0, offsetY: 0 });

  // 이벤트 → 노트 머리 화면 위치(현재 페이지에 없으면 null). 헛침·판정 없는 이벤트도 null
  const locate = useCallback(
    (e: FxEvent): FxLocation | null => {
      if (e.stray || e.judgement === null || e.noteIndex === undefined || e.noteIndex === null) return null;
      const g = geom.current;
      const at = noteHeadAt({
        slots: g.slots,
        layoutOf: model.layoutOf,
        noteIndex: e.noteIndex,
        slotX: (i) => GUTTER_X + i * g.slotW,
        slotW: g.slotW,
        lineY: headY,
      });
      // 이펙트 캔버스는 그리기 캔버스의 세로 정렬 offset을 모르므로 여기서 더한다. 크기는 머리의 2배(D3)
      return at ? { geo: { cx: at.x, cy: at.y + g.offsetY, rx: HEAD_RX * 2, ry: HEAD_RY * 2, k: 1 }, shape: 'head' } : null;
    },
    [model],
  );

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const colors = readColors(canvas);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const { sheet, layoutOf } = model;
    const { barMs, beatMs, originMs } = sheet;
    const totalBars = sheet.bars.length;
    let width = wrap.clientWidth;
    let height = wrap.clientHeight;
    const ro = new ResizeObserver(() => {
      width = wrap.clientWidth;
      height = wrap.clientHeight;
    });
    ro.observe(wrap);

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
      const grid = gridTimeAt(chart, raw);
      const t = reduced ? snapToBeat(grid, beatMs) : grid;
      const perPage = barsPerPage(inner);
      const slotW = inner / perPage;
      const leadBars = p.countInMs > 0 ? 1 : 0;
      const slots = pagerSlots(t, barMs, beatMs, perPage, totalBars, leadBars);
      geom.current.slots = slots;
      geom.current.slotW = slotW;
      geom.current.offsetY = offsetY;

      slots.forEach((slot, i) => {
        if (slot.bar === null && !slot.lead) return;
        ctx.save();
        ctx.beginPath();
        // 첫 슬롯은 캔버스 왼쪽 끝이라 여유가 필요 없다
        // 첫 슬롯은 왼쪽 여백(박자표 자리)까지 포함한다
        const slotX = GUTTER_X + i * slotW;
        const clipLeft = i === 0 ? 0 : slotX - CLIP_PAD;
        ctx.rect(clipLeft, -offsetY, slotX + slotW - clipLeft, height);
        ctx.clip();
        if (slot.upcoming) ctx.globalAlpha = 0.35;
        if (slot.bar === null) {
          // 빈 준비 마디: 보표·마디선만
          drawEmptyBar(ctx, slotX, width, colors);
          ctx.restore();
          return;
        }
        drawSheet(ctx, {
          chart,
          noteStates: p.noteStates,
          strayHits: p.strayHits,
          hitMarks: hitMarks?.current,
          songTime: songTimeAtGrid(chart, slot.bar * barMs),
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
          openWarnings: openWarnings?.current,
          nowMs,
        });
        ctx.restore();
      });

      const { slot, ratio } = cursorPos(t, barMs, perPage, leadBars);
      const x = xInBar(GUTTER_X + slot * slotW, slotW, ratio); // 노트 시각에 그 머리 중심을 지난다
      drawCursor(ctx, x, STAFF_TOP_Y - 30, STAFF_BOTTOM_Y + 40, colors);
      drawBeatLabel(ctx, x + 12, STAFF_BOTTOM_Y + 46, grid, beatMs, chart.beatsPerBar, colors);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [chart, model, openWarnings, hitMarks]);

  return (
    <div ref={wrapRef} className="sheet-pager">
      <canvas ref={canvasRef} className="sheet-strip-canvas" />
      {fxSource && <FxCanvas space="pixel" mode="sheet" source={fxSource} locate={locate} />}
      {overlay && <div className="sheet-pager-overlay">{overlay}</div>}
    </div>
  );
}
