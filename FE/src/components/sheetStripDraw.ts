// 악보 스트립 그리기 — 5선 드럼 악보를 Canvas 2D에 그리는 순수 함수. SheetPager(연주 중 마디 고정 페이지)과 SheetSnippet(결과 페이지 정지 화면)이 같이 쓴다.
import type { Judgement } from '@/domain/judgement';
import { gridTimeOf, type BarLayout, type GridChart } from '@/domain/sheet';
import { xInBar, xOfTime, xOfTimeInBar } from './sheetStripMath';

const LINE_GAP = 10; // 선 간격(px). 보표 위치 1단위(반 칸) = 5px
const STAFF_BOTTOM = 150; // 선 1의 y
const STEM_LEN = 34;
const HEAD_RX = 6;
const HEAD_RY = 4.5;
const STEM_DX = HEAD_RX - 0.75; // 기둥은 머리 오른쪽
/** 격자 밖 노트 표시 점의 반지름(px). 지름 3px */
const OFF_GRID_DOT_R = 1.5;

export interface Colors {
  ink: string;
  inkDim: string;
  inkFaint: string;
  /** 기준선·박 번호 색 */
  base: string;
  /** 기준선 글로우 색 */
  baseGlow: string;
  judge: Record<Judgement, string>;
}

/** 색을 읽는다. 캔버스 요소의 계산된 스타일에서 디자인 토큰(tokens.css)을 읽고, 없으면 기본값을 쓴다 */
export function readColors(el: Element = document.documentElement): Colors {
  const s = getComputedStyle(el);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    ink: v('--text-1', '#f2f5f8'),
    inkDim: v('--text-2', '#98a2b1'),
    inkFaint: v('--text-3', '#828d9e'),
    base: v('--brand-text', '#52b2dd'),
    baseGlow: v('--brand', '#35a3d4'),
    judge: {
      PERFECT: v('--perfect', '#8fceea'),
      GOOD: v('--good', '#4cd07d'),
      MISS: v('--miss', '#ff6b70'),
    },
  };
}

const yOfPos = (pos: number) => STAFF_BOTTOM - pos * (LINE_GAP / 2);
/** 보표 맨 위 선·맨 아래 선의 y. SheetPager가 커서 길이를 맞출 때 쓴다 */
export const STAFF_TOP_Y = yOfPos(8);
export const STAFF_BOTTOM_Y = yOfPos(0);

export interface DrawSheetOpts {
  chart: GridChart;
  /** chart.notes와 같은 인덱스. 미판정은 null */
  noteStates: (Judgement | null)[];
  /** 채보 밖 타격(곡 시각 ms) */
  strayHits: { timeMs: number }[];
  /** 기준선이 가리키는 곡 시각(반주 기준, reduced motion이면 이미 마디 경계로 내린 값) */
  songTime: number;
  /** 스냅 전 곡 시각(반주 기준). 박 번호·카운트인 숫자에 쓴다(없으면 songTime) */
  rawSongTime?: number;
  /** 격자 원점(ms, 반주 기준). 마디 bar의 왼쪽은 originMs + bar·barMs */
  originMs: number;
  width: number;
  height: number;
  barPx: number;
  baseRatio: number;
  colors: Colors;
  layoutOf: (bar: number) => BarLayout;
  /** 그릴 마디 범위(양쪽 포함) */
  bars: { first: number; last: number };
  barMs: number;
  beatMs: number;
  /** false면 기준선·박 번호·카운트인 숫자를 그리지 않는다 */
  showBase: boolean;
  countInMs?: number;
}

/** 한 프레임을 그린다. 캔버스 크기·transform·clearRect는 호출자 몫이다 */
export function drawSheet(ctx: CanvasRenderingContext2D, opts: DrawSheetOpts): void {
  const { chart, noteStates, strayHits, songTime: t, originMs, width, barPx, baseRatio, colors, layoutOf, bars, barMs, beatMs, showBase, countInMs } = opts;
  const raw = opts.rawSongTime ?? t;
  const { first, last } = bars;
  const X = (ms: number) => xOfTime(ms, t, width, barPx, baseRatio, barMs);
  const baseX = width * baseRatio;
  const top = STAFF_TOP_Y;
  const bottom = STAFF_BOTTOM_Y;

  // 보표 5선
  ctx.strokeStyle = colors.inkFaint;
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = Math.round(yOfPos(i * 2)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 박자표: 첫 마디(격자 원점) 앞
  const x0 = X(originMs);
  if (x0 > -60 && x0 < width + 60) {
    ctx.fillStyle = colors.ink;
    ctx.font = '700 22px Pretendard Variable, Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(chart.beatsPerBar), x0 - 22, yOfPos(6));
    ctx.fillText('4', x0 - 22, yOfPos(2));
  }

  for (let bar = first; bar <= last; bar++) {
    const left = X(originMs + bar * barMs);
    // 마디선·번호
    ctx.strokeStyle = colors.inkDim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.stroke();
    ctx.fillStyle = colors.inkFaint;
    ctx.font = '600 11px Pretendard Variable, Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(bar + 1), left + 4, top - 22);

    const layout = layoutOf(bar);

    // 기둥: 같은 x(코드 음표)는 한 기둥. 위 방향 통일
    const stemTop = new Map<number, number>(); // xRatio → 기둥 끝 y
    const columns = new Map<number, number[]>(); // xRatio → 보표 위치들
    for (const g of layout.glyphs) {
      const list = columns.get(g.xRatio);
      if (list) list.push(g.line);
      else columns.set(g.xRatio, [g.line]);
    }
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.5;
    for (const [xr, lines] of columns) {
      const x = xInBar(left, barPx, xr) + STEM_DX;
      const yTop = yOfPos(Math.max(...lines)) - STEM_LEN;
      stemTop.set(xr, yTop);
      ctx.beginPath();
      ctx.moveTo(x, yOfPos(Math.min(...lines)));
      ctx.lineTo(x, yTop);
      ctx.stroke();
    }

    // 빔: 기둥 끝을 한 높이로 맞추고 가로 막대를 그린다
    ctx.fillStyle = colors.ink;
    for (const b of layout.beams) {
      const xrs = [...new Set(b.glyphIndices.map((gi) => layout.glyphs[gi].xRatio))];
      const yBeam = Math.min(...xrs.map((xr) => stemTop.get(xr)!));
      const xa = xInBar(left, barPx, Math.min(...xrs)) + STEM_DX;
      const xb = xInBar(left, barPx, Math.max(...xrs)) + STEM_DX;
      ctx.beginPath();
      for (const xr of xrs) {
        const x = xInBar(left, barPx, xr) + STEM_DX;
        ctx.moveTo(x, stemTop.get(xr)!);
        ctx.lineTo(x, yBeam);
      }
      ctx.stroke();
      ctx.fillRect(xa - 0.75, yBeam, xb - xa + 1.5, 3);
      if (b.level === 2) ctx.fillRect(xa - 0.75, yBeam + 5, xb - xa + 1.5, 3);
    }

    // 머리 (판정 색)
    for (const g of layout.glyphs) {
      const x = xInBar(left, barPx, g.xRatio);
      const y = yOfPos(g.line);
      const j = noteStates[g.noteIndex];
      const c = j ? colors.judge[j] : colors.ink;
      if (g.line >= 10) {
        // 덧줄
        ctx.strokeStyle = colors.inkFaint;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - HEAD_RX - 4, Math.round(y) + 0.5);
        ctx.lineTo(x + HEAD_RX + 4, Math.round(y) + 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = 2;
      if (g.head === 'normal') {
        ctx.beginPath();
        ctx.ellipse(x, y, HEAD_RX, HEAD_RY, -0.35, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const r = 4.5;
        ctx.beginPath();
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.moveTo(x + r, y - r);
        ctx.lineTo(x - r, y + r);
        ctx.stroke();
        if (g.head === 'circle-cross') {
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // 격자 밖 노트: 머리 오른쪽 위에 작은 점("악보보다 조금 앞뒤로 친다")
      if (g.offGrid) {
        ctx.fillStyle = colors.inkFaint;
        ctx.beginPath();
        ctx.arc(x + HEAD_RX + 3, y - HEAD_RY - 3, OFF_GRID_DOT_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 채보 밖 타격: 보표 아래 작은 점(같은 시각 노트 머리와 같은 x, 마디 앞 여백 포함)
  ctx.fillStyle = colors.judge.MISS;
  for (const h of strayHits) {
    const x = xOfTimeInBar(h.timeMs, t, width, barPx, baseRatio, barMs, originMs);
    if (x < -4 || x > width + 4) continue;
    ctx.beginPath();
    ctx.arc(x, bottom + 26, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!showBase) return;

  drawCursor(ctx, baseX, top - 30, bottom + 40, colors);
  drawBeatLabel(ctx, baseX + 12, bottom + 46, gridTimeOf(raw, originMs), beatMs, chart.beatsPerBar, colors, countInMs);
}

/** 고정 기준선(커서): 2px + 글로우. x는 선의 x, top·bottom은 선의 양 끝 y */
export function drawCursor(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, colors: Colors): void {
  ctx.save();
  ctx.strokeStyle = colors.base;
  ctx.lineWidth = 2;
  ctx.shadowColor = colors.baseGlow;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  ctx.restore();
}

/**
 * 현재 박 번호(큰 숫자 + 작은 "박") / 리드인 남은 박 수.
 * x는 숫자의 왼쪽 끝, y는 글자 기준선이다. gridTime은 격자 시각(곡 시각 − 원점)이며 0보다 작으면 1마디 1박 전(카운트인·인트로)이다.
 */
export function drawBeatLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  gridTime: number,
  beatMs: number,
  beatsPerBar: number,
  colors: Colors,
  countInMs?: number,
): void {
  let label: string | null = null;
  if (gridTime < 0) {
    if (countInMs === undefined || gridTime >= -countInMs) {
      label = String(Math.max(1, Math.ceil(-gridTime / beatMs - 1e-9)));
    }
  } else {
    label = String((Math.floor(gridTime / beatMs) % beatsPerBar) + 1);
  }
  if (label === null) return;
  ctx.fillStyle = colors.base;
  ctx.font = '700 32px Pretendard Variable, Pretendard, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x, y);
  const w = ctx.measureText(label).width;
  ctx.fillStyle = colors.inkFaint;
  ctx.font = '600 12px Pretendard Variable, Pretendard, sans-serif';
  ctx.fillText('박', x + w + 6, y);
}
