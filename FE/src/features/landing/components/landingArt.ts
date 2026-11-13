// 랜딩 그림 데이터(파형·채보·결과 악보). SVG 문자열이 아니라 속성 객체 배열을 돌려준다.
// 순수 함수 — React·DOM을 쓰지 않는다.

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export interface RectShape {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  fill: string;
}

export interface LineShape {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  stroke: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface EllipseShape {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
}

export const VIZ_WIDTH = 980;
export const VIZ_HEIGHT = 300;

// ───── 음원·드럼 파형 (시드 7 의사난수, 결정적) ─────
export function waveformBars(): { mix: RectShape[]; drum: RectShape[] } {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const N = 140;
  const mid = VIZ_HEIGHT / 2;
  const beatAt = (i: number) => (i % 8 === 0 ? 1 : i % 4 === 0 ? 0.75 : i % 2 === 0 ? 0.45 : 0);
  const mix: RectShape[] = [];
  const drum: RectShape[] = [];
  for (let i = 0; i < N; i++) {
    const x = 40 + i * ((VIZ_WIDTH - 80) / N);
    const step = Math.floor(i / 2.2);
    const hit = beatAt(step) * (i % 2.2 < 1 ? 1 : 0.35);
    const a = clamp(0.22 + rnd() * 0.45 + hit * 0.35, 0, 1) * 110;
    mix.push({ x, y: mid - a, width: 3.2, height: a * 2, rx: 1.6, fill: 'rgba(245,245,247,.55)' });
    // 난수는 mix 다음, 타격이 약할 때만 한 번 더 뽑는다(시안 순서 그대로)
    const d = hit > 0.1 ? hit * 118 : 4 + rnd() * 6;
    drum.push({
      x,
      y: mid - d,
      width: 3.2,
      height: d * 2,
      rx: 1.6,
      fill: hit > 0.1 ? '#f5f5f7' : 'rgba(245,245,247,.25)',
    });
  }
  return { mix, drum };
}

// ───── 채보: 레인 3개 + 노트 ─────
export interface ChartLane {
  key: 'HH' | 'SN' | 'BD';
  label: string;
  y: number;
  line: LineShape;
}

export interface ChartArt {
  lanes: ChartLane[];
  /** 마디(박) 세로선 5개 */
  barLines: LineShape[];
  notes: RectShape[];
}

export function chartArt(): ChartArt {
  const defs: { key: ChartLane['key']; label: string; y: number }[] = [
    { key: 'HH', label: 'HI-HAT', y: 95 },
    { key: 'SN', label: 'SNARE', y: 160 },
    { key: 'BD', label: 'KICK', y: 225 },
  ];
  const y = { HH: 95, SN: 160, BD: 225 };
  const lanes: ChartLane[] = defs.map((d) => ({
    ...d,
    line: { x1: 110, x2: 950, y1: d.y, y2: d.y, stroke: 'rgba(255,255,255,.1)' },
  }));
  const barLines: LineShape[] = [];
  for (let b = 0; b <= 4; b++) {
    barLines.push({
      x1: 110 + b * 210,
      x2: 110 + b * 210,
      y1: 70,
      y2: 250,
      stroke: `rgba(255,255,255,${b % 4 === 0 ? 0.25 : 0.08})`,
    });
  }
  const notes: RectShape[] = [];
  for (let i = 0; i < 32; i++) {
    const x = 122 + i * 26.25;
    notes.push({ x: x - 7, y: y.HH - 7, width: 14, height: 14, rx: 3, fill: 'rgba(245,245,247,.7)' });
    if (i % 8 === 4) notes.push({ x: x - 9, y: y.SN - 9, width: 18, height: 18, rx: 4, fill: '#f5f5f7' });
    if (i % 8 === 0 || i % 16 === 10) notes.push({ x: x - 9, y: y.BD - 9, width: 18, height: 18, rx: 9, fill: '#f5f5f7' });
  }
  return { lanes, barLines, notes };
}

// ───── 결과 악보: 5선 4마디, 3마디 강조, 빨간 음표 2개 ─────
export interface SheetArt {
  highlight: { x: number; y: number; width: number; height: number; rx: number; labelX: number; labelY: number };
  staffLines: LineShape[];
  barLines: LineShape[];
  /** 하이햇 x 표시: path d와 줄기 선 */
  hihats: { d: string; stem: LineShape }[];
  notes: EllipseShape[];
  beams: LineShape[];
}

// 놓친 음표: 밤거리 네온 간판 같은 빨강. 번지는 빛은 ResultSection의 SVG 필터가 준다
export const SHEET_RED = '#ff2a55';
const SHEET_INK = '#1d1d1f';

export function sheetArt(): SheetArt {
  const top = 40;
  const gap = 12;
  const x0 = 20;
  const x1 = 880;
  const mw = (x1 - x0) / 4;
  const highlight = {
    x: x0 + mw * 2,
    y: top - 26,
    width: mw,
    // 강조 상자는 악보 아래 '3마디' 글자까지 감싼다. 글자가 하이햇과 겹치지 않게 빔(top + 64) 아래에 둔다
    height: gap * 4 + 80,
    rx: 12,
    labelX: x0 + mw * 2.5,
    labelY: top + gap * 4 + 40,
  };
  const staffLines: LineShape[] = [];
  for (let i = 0; i < 5; i++) {
    staffLines.push({ x1: x0, x2: x1, y1: top + i * gap, y2: top + i * gap, stroke: SHEET_INK, strokeWidth: 1 });
  }
  const barLines: LineShape[] = [];
  for (let m = 0; m <= 4; m++) {
    barLines.push({
      x1: x0 + m * mw,
      x2: x0 + m * mw,
      y1: top,
      y2: top + gap * 4,
      stroke: SHEET_INK,
      strokeWidth: m === 4 ? 2.5 : 1,
    });
  }
  const hihats: SheetArt['hihats'] = [];
  const notes: EllipseShape[] = [];
  const beams: LineShape[] = [];
  const step = (mw - 34) / 8;
  for (let m = 0; m < 4; m++) {
    for (let k = 0; k < 8; k++) {
      const x = x0 + m * mw + 22 + k * step;
      hihats.push({
        d: `M${x - 4} ${top - 14} l8 8 M${x + 4} ${top - 14} l-8 8`,
        stem: { x1: x + 4, x2: x + 4, y1: top - 10, y2: top + gap * 4 + 16, stroke: SHEET_INK, strokeWidth: 1.2, opacity: 0.9 },
      });
      if (k === 2 || k === 6) {
        notes.push({ cx: x, cy: top + gap * 1.5, rx: 5.5, ry: 4.2, fill: m === 2 && k === 6 ? SHEET_RED : SHEET_INK });
      }
      if (k === 0 || k === 4 || (m === 2 && k === 5)) {
        notes.push({ cx: x, cy: top + gap * 3.5, rx: 5.5, ry: 4.2, fill: m === 2 && k === 5 ? SHEET_RED : SHEET_INK });
      }
    }
    const bx = x0 + m * mw + 22;
    beams.push({
      x1: bx + 4,
      x2: bx + 4 + 7 * step,
      y1: top + gap * 4 + 16,
      y2: top + gap * 4 + 16,
      stroke: SHEET_INK,
      strokeWidth: 3,
    });
  }
  return { highlight, staffLines, barLines, hihats, notes, beams };
}
