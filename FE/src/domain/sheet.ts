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

export type CountSub = '' | 'e' | '&' | 'a';

const COUNT_SUBS: CountSub[] = ['', 'e', '&', 'a'];

/**
 * 마디 안 칸 번호를 드러머가 세는 박 위치(1, 1e, 1&, 1a …)로 바꾼다.
 * 한 박 = stepsPerBar / beatsPerBar 칸(보통 4). 박 안 칸 위치 0/1/2/3 → ''/'e'/'&'/'a'.
 */
export function countLabel(step: number, stepsPerBar: number, beatsPerBar: number): { beat: number; sub: CountSub } {
  const stepsPerBeat = stepsPerBar / beatsPerBar;
  const beat = Math.floor(step / stepsPerBeat);
  const inBeat = step - beat * stepsPerBeat;
  return { beat: beat + 1, sub: COUNT_SUBS[Math.min(3, Math.max(0, Math.round(inBeat)))] };
}

/* ---------- 5선 악보 글리프 배치 (MODE-003-sheet-strip 3-1·3-2) ---------- */

/** 결과 페이지 미니 악보의 마디 폭 상한(px) */
export const SHEET_BAR_PX = 320;

export type NoteHead = 'normal' | 'cross' | 'circle-cross';

/**
 * 패드 → 보표 위치. 반 칸 단위 정수: 선1 = 0, 공간1 = 1, 선2 = 2 … 선5 = 8, 선5 위 공간 = 9, 덧줄 = 10.
 * (스트립 문서 3-1 표의 pos 값 그대로)
 */
const STAFF_POS: Record<PadId, { line: number; head: NoteHead }> = {
  HIHAT_PEDAL: { line: 0, head: 'cross' },
  KICK: { line: 1, head: 'normal' },
  FLOOR_TOM: { line: 3, head: 'normal' },
  SNARE: { line: 5, head: 'normal' },
  SMALL_TOM: { line: 7, head: 'normal' },
  MID_TOM: { line: 6, head: 'normal' },
  RIDE: { line: 8, head: 'cross' },
  HIHAT: { line: 9, head: 'cross' },
  CRASH: { line: 10, head: 'circle-cross' },
};

export function staffPosOf(pad: PadId): { line: number; head: NoteHead } {
  return STAFF_POS[pad];
}

export interface NoteGlyph {
  /** chart.notes 인덱스 (판정 상태 배열과 같은 인덱스) */
  noteIndex: number;
  pad: PadId;
  /** 마디 안 위치 0~1 (시간 선형, 16분 격자 양자화 후) */
  xRatio: number;
  /** 보표 위치(반 칸 단위, 위 표 참고) */
  line: number;
  head: NoteHead;
  stem: boolean;
}

export interface BeamGroup {
  /** BarLayout.glyphs 인덱스. 같은 박 안 글리프 전부(코드 음표 포함) */
  glyphIndices: number[];
  level: 1 | 2;
}

export interface BarLayout {
  bar: number;
  glyphs: NoteGlyph[];
  beams: BeamGroup[];
}

export function layoutBar(chart: Pick<Chart, 'bpm' | 'beatsPerBar' | 'notes'>, barIndex: number, opts: { stepsPerBar?: number } = {}): BarLayout {
  const stepsPerBar = opts.stepsPerBar ?? chart.beatsPerBar * 4;
  const stepMs = ((60_000 / chart.bpm) * chart.beatsPerBar) / stepsPerBar;
  const stepsPerBeat = stepsPerBar / chart.beatsPerBar;

  const glyphs: NoteGlyph[] = [];
  const steps: number[] = []; // glyphs와 같은 인덱스의 마디 안 step
  chart.notes.forEach((n, noteIndex) => {
    const idx = Math.max(0, Math.round(n.timeMs / stepMs));
    if (Math.floor(idx / stepsPerBar) !== barIndex) return;
    const step = idx % stepsPerBar;
    const pos = STAFF_POS[n.pad];
    glyphs.push({ noteIndex, pad: n.pad, xRatio: step / stepsPerBar, line: pos.line, head: pos.head, stem: true });
    steps.push(step);
  });

  // 같은 박 안에서 서로 다른 step이 2개 이상이면 빔으로 묶는다
  const byBeat = new Map<number, number[]>();
  steps.forEach((step, gi) => {
    const beat = Math.floor(step / stepsPerBeat);
    const list = byBeat.get(beat);
    if (list) list.push(gi);
    else byBeat.set(beat, [gi]);
  });
  const beams: BeamGroup[] = [];
  for (const [, indices] of [...byBeat.entries()].sort((a, b) => a[0] - b[0])) {
    const distinct = new Set(indices.map((gi) => steps[gi]));
    if (distinct.size < 2) continue;
    // 박 안 오프셋이 8분 칸(stepsPerBeat/2의 배수)이 아닌 노트가 있으면 16분 → 2줄
    const half = stepsPerBeat / 2;
    const has16th = stepsPerBeat >= 4 && indices.some((gi) => (steps[gi] % stepsPerBeat) % half !== 0);
    beams.push({ glyphIndices: indices, level: has16th ? 2 : 1 });
  }
  return { bar: barIndex, glyphs, beams };
}
