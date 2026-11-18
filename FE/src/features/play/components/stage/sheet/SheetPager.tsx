// 악보 페이저 — 일반 모드는 연속 스크롤, 모션 줄이기 모드는 고정 페이지를 사용한다 (Canvas 2D).
// 슬롯·커서·박 라벨은 격자 시각(gridTimeAt: 빠르기 구간이 없으면 곡 시각 − chart.offsetMs, 있으면 박 번호 기준)으로 계산한다.
// 카운트다운이 켜져 있으면(countInMs > 0) 악보를 한 칸 오른쪽으로 밀어 첫 칸을 빈 준비 마디로 두고, 카운트다운이 끝나면 커서가
// 준비 마디를 지나 그대로 1마디로 들어간다(설계 MODE-001-lead-in-bars D20). 그보다 앞(카운트다운·인트로)은 커서가 첫 칸 왼쪽에 선다.
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { FxCanvas } from '@/components/fx/FxCanvas';
import type { FxEvent, FxLocation, FxSource } from '@/domain/hitFx/types';
import type { Chart } from '@/domain/song/chart';
import type { Judgement } from '@/domain/play/judgement';
import { buildSheet, gridTimeAt, layoutBar, songTimeAtGrid, type BarLayout } from '@/domain/song/sheet';
import { barsPerPage, cursorPos, flowGeometry, noteHeadAt, OVERLAY_RESERVE_PX, overlayLift, pagerSlots, snapToBeat, staffOffsetY, staffScale, type PagerSlot } from './sheetPagerMath';
import { xInBar } from '@/components/sheetmusic/sheetStripMath';
import { drawBeatLabel, drawCursor, drawEmptyBar, drawSheet, HEAD_RX, HEAD_RY, headY, readColors, STAFF_BOTTOM_Y, STAFF_TOP_Y, type HitMark } from '@/components/sheetmusic/sheetStripDraw';

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

export function SheetPager({ chart, noteStates, strayHits, getSongTime, openWarnings, hitMarks, fxSource, overlay, countInMs = 0 }: SheetPagerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 최신 props를 그리기 루프에 넘긴다 (렌더 중 ref 쓰기 회피)
  const hasOverlay = Boolean(overlay);
  const live = useRef({ noteStates, strayHits, getSongTime, countInMs, hasOverlay });
  useEffect(() => {
    live.current = { noteStates, strayHits, getSongTime, countInMs, hasOverlay };
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

  // 마지막으로 그린 프레임의 슬롯 배치. 이펙트 위치 찾기가 읽는다(그리기 루프가 매 프레임 갱신).
  // slotW·offsetY·firstX·width는 배율 k를 나눈 논리 좌표이고, CSS 픽셀로 바꿀 때 k를 곱한다
  const geom = useRef<{ slots: PagerSlot[]; slotW: number; offsetY: number; firstX: number; width: number; k: number; continuousStepsPerBar?: number }>({ slots: [], slotW: 0, offsetY: 0, firstX: 0, width: 0, k: 1 });

  // 이벤트 → 노트 머리 화면 위치(현재 페이지에 없으면 null). 헛침·판정 없는 이벤트도 null
  const locate = useCallback(
    (e: FxEvent): FxLocation | null => {
      if (e.stray || e.judgement === null || e.noteIndex === undefined || e.noteIndex === null) return null;
      const g = geom.current;
      const at = noteHeadAt({
        slots: g.slots,
        layoutOf: model.layoutOf,
        noteIndex: e.noteIndex,
        slotX: (i) => g.firstX + i * g.slotW,
        slotW: g.slotW,
        continuousStepsPerBar: g.continuousStepsPerBar,
        lineY: headY,
      });
      // 이펙트 캔버스는 그리기 캔버스의 세로 정렬 offset·배율을 모르므로 여기서 더하고 곱해 CSS 픽셀로 바꾼다. 크기는 머리의 2배(D3)
      return at && at.x >= 0 && at.x <= g.width
        ? { geo: { cx: at.x * g.k, cy: (at.y + g.offsetY) * g.k, rx: HEAD_RX * 2 * g.k, ry: HEAD_RY * 2 * g.k, k: g.k }, shape: 'head' }
        : null;
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
    // 정지 후 시간이 null이어도 마지막 프레임 위치를 유지한다.
    let lastRaw = 0;
    let lastLift = -1;
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
      if (width <= 0 || height <= 0) {
        geom.current.slots = [];
        return;
      }
      // 악보를 배율 k로 그린다: 이후 좌표는 모두 논리 크기(W×H = 칸 ÷ k)이고 변환이 한 번에 키운다
      // 타이밍 막대가 있으면 그 자리(칸 아래)를 빼고 악보를 맞춘다: 박 번호가 막대 밑에 깔리지 않는다
      const reservePx = p.hasOverlay ? OVERLAY_RESERVE_PX : 0;
      const k = staffScale(height - reservePx, width);
      // 칸이 악보보다 높으면 타이밍 막대를 박 번호 바로 아래로 올린다(값이 바뀔 때만 쓴다)
      const lift = p.hasOverlay ? Math.round(overlayLift(height, k, reservePx)) : 0;
      if (lift !== lastLift) {
        lastLift = lift;
        wrap.style.setProperty('--sheet-overlay-lift', `${lift}px`);
      }
      const W = width / k;
      const H = height / k;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // 세로 가운데 정렬. 가로는 슬롯 x에 왼쪽 여백을 더한다(보표 선은 drawSheet가 전체 폭에 긋는다)
      const offsetY = staffOffsetY(H, reservePx / k);
      ctx.translate(0, offsetY);
      const inner = Math.max(1, W - GUTTER_X);

      const raw = p.getSongTime() ?? lastRaw;
      lastRaw = raw;
      const grid = gridTimeAt(chart, raw);
      const t = reduced ? snapToBeat(grid, beatMs) : Math.min(grid, gridTimeAt(chart, chart.durationMs));
      const perPage = barsPerPage(inner);
      const slotW = inner / perPage;
      const leadBars = p.countInMs > 0 ? 1 : 0;
      if (!reduced) {
        const flow = flowGeometry(t, barMs, sheet.stepsPerBar, W, GUTTER_X, slotW, totalBars, leadBars);
        const slots: PagerSlot[] = [];
        for (let bar = flow.first; bar <= flow.last; bar++) slots.push({ bar, upcoming: false });
        geom.current = { slots, slotW, offsetY, firstX: flow.barZeroX + flow.first * slotW, width: W, k, continuousStepsPerBar: sheet.stepsPerBar };
        if (leadBars && flow.barZeroX - slotW < W && flow.barZeroX > 0) {
          drawEmptyBar(ctx, flow.barZeroX - slotW, W, colors);
        }
        drawSheet(ctx, {
          chart, noteStates: p.noteStates, strayHits: p.strayHits, hitMarks: hitMarks?.current,
          songTime: songTimeAtGrid(chart, 0), rawSongTime: raw, originMs, width: W, height: H,
          barPx: slotW, baseRatio: flow.barZeroX / W, colors, layoutOf,
          bars: { first: flow.first, last: flow.last }, barMs, beatMs, showBase: false,
          continuousStepsPerBar: sheet.stepsPerBar, openWarnings: openWarnings?.current, nowMs,
        });
        drawCursor(ctx, flow.cursorX, STAFF_TOP_Y - 30, STAFF_BOTTOM_Y + 40, colors);
        drawBeatLabel(ctx, flow.cursorX + 12, STAFF_BOTTOM_Y + 46, t, beatMs, chart.beatsPerBar, colors);
        return;
      }
      const slots = pagerSlots(t, barMs, beatMs, perPage, totalBars, leadBars);
      geom.current.slots = slots;
      geom.current.slotW = slotW;
      geom.current.offsetY = offsetY;
      geom.current.firstX = GUTTER_X;
      geom.current.width = W;
      geom.current.k = k;
      geom.current.continuousStepsPerBar = undefined;

      slots.forEach((slot, i) => {
        if (slot.bar === null && !slot.lead) return;
        ctx.save();
        ctx.beginPath();
        // 첫 슬롯은 캔버스 왼쪽 끝이라 여유가 필요 없다
        // 첫 슬롯은 왼쪽 여백(박자표 자리)까지 포함한다
        const slotX = GUTTER_X + i * slotW;
        const clipLeft = i === 0 ? 0 : slotX - CLIP_PAD;
        ctx.rect(clipLeft, -offsetY, slotX + slotW - clipLeft, H);
        ctx.clip();
        if (slot.upcoming) ctx.globalAlpha = 0.35;
        if (slot.bar === null) {
          // 빈 준비 마디: 보표·마디선만
          drawEmptyBar(ctx, slotX, W, colors);
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
          width: W,
          height: H,
          barPx: slotW,
          baseRatio: slotX / W,
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
