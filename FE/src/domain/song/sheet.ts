// 악보 모드의 격자 모델 (MODE-sheet-practice 3-2). 채보를 마디 × 16분음 칸으로 양자화한다.
// 격자 원점은 chart.offsetMs(1마디 1박 시각)이고, 칸·마디는 모두 "격자 시각 = timeMs − originMs"로 센다 (MODE-003-sheet-grid-origin 3장).
// 빠르기 구간(tempoSegments)이 있는 곡은 격자 시각을 박 번호 × 첫 빠르기 한 박 길이로 센다(gridTimeAt). 마디 폭이 같고
// 노트가 그 구간 빠르기의 칸에 맞는다 (CHART-003-variable-tempo-exp). 구간이 없으면 timeMs − originMs와 같다.
import type { Chart } from './chart';
import { ALL_PADS, type PadId } from '@/domain/kit/pads';
import { beatAtMs, beatTimeMs } from '@/domain/time/tempo';

/** 격자 원점·격자 밖 판정에 필요한 채보 필드. offsetMs가 없으면(이전 플레이 로그) 0으로 본다 */
export type GridChart = Pick<Chart, 'bpm' | 'beatsPerBar' | 'notes'> & Partial<Pick<Chart, 'offsetMs' | 'tempoSegments'>>;

/** 격자 원점(ms, 반주 기준). 원점 정의를 이 한 곳에 둔다 */
export function gridOriginMs(chart: Partial<Pick<Chart, 'offsetMs'>>): number {
  return chart.offsetMs ?? 0;
}

/** 반주 기준 시각 → 격자 시각(빠르기 구간 없는 곡). 음수면 리드인(카운트인·인트로) 구간 */
export function gridTimeOf(songTimeMs: number, originMs: number): number {
  return songTimeMs - originMs;
}

type TimeChart = Pick<Chart, 'bpm'> & Partial<Pick<Chart, 'offsetMs' | 'tempoSegments'>>;

const hasSegments = (chart: TimeChart): boolean => (chart.tempoSegments?.length ?? 0) > 1;

/** 반주 기준 시각 → 격자 시각. 빠르기 구간이 있으면 박 번호 × (60000 / chart.bpm). 없으면 gridTimeOf와 같음 */
export function gridTimeAt(chart: TimeChart, songTimeMs: number): number {
  if (!hasSegments(chart)) return gridTimeOf(songTimeMs, gridOriginMs(chart));
  return (beatAtMs(chart, songTimeMs) * 60_000) / chart.bpm;
}

/** 격자 시각 → 반주 기준 시각. gridTimeAt의 역함수 */
export function songTimeAtGrid(chart: TimeChart, gridMs: number): number {
  if (!hasSegments(chart)) return gridOriginMs(chart) + gridMs;
  return beatTimeMs(chart, (gridMs * chart.bpm) / 60_000);
}

/**
 * 노트 시각을 곡 전체 칸 번호로 양자화한다.
 * offGrid: 가장 가까운 칸 중심에서 stepMs/4(32분음의 절반, BE 솎기 허용 오차와 같음)보다 먼 노트.
 * 원점 앞 노트는 0칸으로 모은다(못갖춘마디 표시는 후속). 원점보다 허용 폭 안에서 앞선 노트는 1박 타격으로 보고,
 * 그보다 앞선 노트만 offGrid다(AI 박 시각 해상도 20ms 때문에 첫 박 타격이 원점보다 조금 앞설 수 있다).
 */
export function stepIndexOf(timeMs: number, originMs: number, stepMs: number): { idx: number; offGrid: boolean } {
  return stepOfGrid(gridTimeOf(timeMs, originMs), stepMs);
}

/** stepIndexOf와 같은 규칙을 격자 시각(gridTimeAt)으로. 빠르기 구간이 있는 곡도 칸이 구간 빠르기에 맞는다 */
export function stepIndexAt(chart: TimeChart, timeMs: number, stepMs: number): { idx: number; offGrid: boolean } {
  return stepOfGrid(gridTimeAt(chart, timeMs), stepMs);
}

function stepOfGrid(grid: number, stepMs: number): { idx: number; offGrid: boolean } {
  const idx = Math.max(0, Math.round(grid / stepMs));
  const offGrid = Math.abs(grid - idx * stepMs) > stepMs / 4;
  return { idx, offGrid };
}

/** durationMs가 마디 길이의 정수배에서 반올림 오차만큼 벗어나도 마디가 하나 늘지 않게 하는 여유(ms) */
const BAR_COUNT_EPS_MS = 1;

/** 마디 수: 원점을 뺀 길이로 세고, 마지막 노트가 그 뒤에 있으면 그 마디까지 포함한다 */
export function barCountOf(chart: GridChart & Pick<Chart, 'durationMs'>, stepsPerBar = chart.beatsPerBar * 4): number {
  const barMs = (60_000 / chart.bpm) * chart.beatsPerBar;
  const stepMs = barMs / stepsPerBar;
  const byDuration = Math.max(1, Math.ceil((gridTimeAt(chart, chart.durationMs) - BAR_COUNT_EPS_MS) / barMs));
  const maxBar = chart.notes.reduce((m, n) => Math.max(m, Math.floor(stepIndexAt(chart, n.timeMs, stepMs).idx / stepsPerBar)), 0);
  return Math.max(byDuration, maxBar + 1);
}

export interface SheetCell {
  pad: PadId;
  /** 마디 안 칸 번호 0..stepsPerBar-1 */
  step: number;
  noteIndex: number;
  /** 칸 중심에서 stepMs/4보다 먼 노트(배지·글리프에 점 표시) */
  offGrid: boolean;
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
  /** 모델이 쓴 격자 원점(ms, 반주 기준). 호출자는 chart.offsetMs를 다시 읽지 않는다 */
  originMs: number;
}

export function buildSheet(chart: Chart, stepsPerBar = 16): SheetModel {
  const beatMs = 60_000 / chart.bpm;
  const barMs = beatMs * chart.beatsPerBar;
  const stepMs = barMs / stepsPerBar;
  const originMs = gridOriginMs(chart);

  const present = new Set(chart.notes.map((n) => n.pad));
  const rows = ALL_PADS.filter((p) => present.has(p));

  const placed = chart.notes.map((n, noteIndex) => {
    const { idx, offGrid } = stepIndexAt(chart, n.timeMs, stepMs);
    return { bar: Math.floor(idx / stepsPerBar), cell: { pad: n.pad, step: idx % stepsPerBar, noteIndex, offGrid } };
  });

  const barCount = barCountOf(chart, stepsPerBar);

  const bars: SheetBar[] = Array.from({ length: barCount }, (_, index) => ({ index, cells: [] }));
  for (const p of placed) bars[p.bar].cells.push(p.cell);

  return { bars, rows, stepsPerBar, beatsPerBar: chart.beatsPerBar, stepMs, beatMs, barMs, originMs };
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
  /** 칸 중심에서 stepMs/4보다 먼 노트(머리 옆에 점 표시) */
  offGrid: boolean;
  /** 크래시 머리와 빔 사이의 원 위치(px). 배치 캐시에 보관한다 */
  openOffsetY?: number;
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

export function layoutBar(chart: GridChart, barIndex: number, opts: { stepsPerBar?: number } = {}): BarLayout {
  const stepsPerBar = opts.stepsPerBar ?? chart.beatsPerBar * 4;
  const stepMs = ((60_000 / chart.bpm) * chart.beatsPerBar) / stepsPerBar;
  const stepsPerBeat = stepsPerBar / chart.beatsPerBar;

  const glyphs: NoteGlyph[] = [];
  const steps: number[] = []; // glyphs와 같은 인덱스의 마디 안 step
  chart.notes.forEach((n, noteIndex) => {
    const { idx, offGrid } = stepIndexAt(chart, n.timeMs, stepMs);
    if (Math.floor(idx / stepsPerBar) !== barIndex) return;
    const step = idx % stepsPerBar;
    const pos = STAFF_POS[n.pad];
    glyphs.push({ noteIndex, pad: n.pad, xRatio: step / stepsPerBar, line: pos.line, head: pos.head, stem: true, offGrid, ...(n.pad === 'HIHAT' && n.hihatOpen === true ? { openOffsetY: 20 } : {}) });
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
