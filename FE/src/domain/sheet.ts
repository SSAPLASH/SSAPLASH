// 악보 모드의 격자 모델 (MODE-sheet-practice 3-2). 채보를 마디 × 16분음 칸으로 양자화한다.
import type { Chart } from './chart';
import { ALL_PADS, type PadId } from './pads';

export interface SheetCell {
  pad: PadId;
  /** 마디 안 칸 번호 0..stepsPerBar-1 */
  step: number;
  noteIndex: number;
}

export interface SheetBar {
  index: number;
  cells: SheetCell[];
}

export interface SheetModel {
  bars: SheetBar[];
  /** 채보에 등장하는 패드만, ALL_PADS 순서(위에서 아래) */
  rows: PadId[];
  stepsPerBar: number;
  beatsPerBar: number;
  stepMs: number;
  beatMs: number;
  barMs: number;
}

export interface SheetPosition {
  /** 0부터. 카운트인(곡 시각 < 0)이면 음수 */
  bar: number;
  /** 마디 안 박 0..beatsPerBar-1 */
  beat: number;
  /** 마디 안 칸 0..stepsPerBar-1 */
  step: number;
  /** 마디 안 진행률 0..1 (칸 사이 위치까지 포함) */
  fraction: number;
}

/** durationMs가 마디 길이의 정수배에서 반올림 오차만큼 벗어나도 마디가 하나 늘지 않게 하는 여유(ms) */
const BAR_COUNT_EPS_MS = 1;

export function buildSheet(chart: Chart, stepsPerBar = 16): SheetModel {
  const beatMs = 60_000 / chart.bpm;
  const barMs = beatMs * chart.beatsPerBar;
  const stepMs = barMs / stepsPerBar;

  const present = new Set(chart.notes.map((n) => n.pad));
  const rows = ALL_PADS.filter((p) => present.has(p));

  const placed = chart.notes.map((n, noteIndex) => {
    const idx = Math.max(0, Math.round(n.timeMs / stepMs));
    return { bar: Math.floor(idx / stepsPerBar), cell: { pad: n.pad, step: idx % stepsPerBar, noteIndex } };
  });

  const byDuration = Math.max(1, Math.ceil((chart.durationMs - BAR_COUNT_EPS_MS) / barMs));
  const maxBar = placed.reduce((m, p) => Math.max(m, p.bar), 0);
  const barCount = Math.max(byDuration, maxBar + 1);

  const bars: SheetBar[] = Array.from({ length: barCount }, (_, index) => ({ index, cells: [] }));
  for (const p of placed) bars[p.bar].cells.push(p.cell);

  return { bars, rows, stepsPerBar, beatsPerBar: chart.beatsPerBar, stepMs, beatMs, barMs };
}

export function positionAt(model: SheetModel, songTimeMs: number): SheetPosition {
  const bar = Math.floor(songTimeMs / model.barMs);
  const within = songTimeMs - bar * model.barMs; // 0 <= within < barMs
  const fraction = Math.min(1, Math.max(0, within / model.barMs));
  const beat = Math.min(model.beatsPerBar - 1, Math.floor(within / model.beatMs));
  const step = Math.min(model.stepsPerBar - 1, Math.floor(within / model.stepMs));
  return { bar, beat, step, fraction };
}
