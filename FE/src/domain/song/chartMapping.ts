// BE 채보 응답(ChartDetail) → FE Chart 변환 (설계 3-2). 순수 함수, 네트워크 없음.
import type { Chart, ChartNote, ChartSource, Difficulty } from './chart';
import { normalizePadId } from '@/domain/kit/pads';
import { toSafeId } from './songCatalog';
import { tempoSegmentsFrom } from '../time/tempo';

export interface ChartNoteDto {
  noteId: string;
  timeMs: number;
  pad: string;
  hihatOpen?: boolean | null;
  velocityHint?: number | null;
  notation?: { tick: number; durationTicks: number; voice: number } | null;
}

export interface ChartTimingDto {
  bpm: number;
  offsetMs: number;
  timeSignature: string;
  ppq?: number | null;
  tempoMap?: { tick: number; bpm: number }[] | null;
  timeSignatureMap?: { tick: number; numerator: number; denominator: number }[] | null;
}

export interface ChartDetailDto {
  id: number;
  songId: number;
  title: string;
  source: ChartSource;
  difficulty: Difficulty;
  chartVersionId: number;
  version: number;
  schemaVersion: number;
  bpm: number;
  offsetMs: number;
  timeSignature: string;
  beatsPerBar: number;
  durationMs?: number | null;
  timing?: ChartTimingDto | null;
  noteCount: number;
  notes: ChartNoteDto[];
  notationStatus: string;
  hasSheetImages: boolean;
}

export interface SheetPageDto {
  page: number;
  imageUrl: string;
  fromTick: number;
  toTick: number;
  fromMs: number;
  toMs: number;
}

export interface ChartAssetsDto {
  chartVersionId: number;
  notationStatus: string;
  sheetPages: SheetPageDto[];
  accompanimentUrl: string | null;
  /** ISO-8601 시각. 없으면 null */
  assetsExpireAt: string | null;
}

/**
 * BE 채보를 FE Chart로 바꾼다.
 * - 옛 이름은 normalizePadId로 변환하고, 알 수 없는 pad 노트는 버리고 경고를 한 번만 남긴다.
 * - `timeMs`는 반주 시작 기준 절대값이라 offsetMs를 더하지 않는다.
 * - tempoMap이 둘 이상이고 ppq가 있으면 `tempoSegments`를 만든다(메트로놈·연주 화면 마디선·악보 화면).
 * - timeSignatureMap이 둘 이상이거나 tempoSegments를 못 만든 tempoMap이면 `variableTempo`로 표시한다(악보 화면은 고정 bpm).
 * - `hasAccompaniment`는 곡 상세 값(또는 자산 확인 결과)을 호출자가 넘긴다.
 */
export function chartFromDetail(detail: ChartDetailDto, hasAccompaniment: boolean): Chart {
  const chartVersionId = toSafeId(detail.chartVersionId, 'chartVersionId');
  const songNumericId = toSafeId(detail.songId, 'songId');
  const chartId = toSafeId(detail.id, 'chartId');

  const notes: ChartNote[] = [];
  const dropped = new Set<string>();
  for (const n of detail.notes) {
    const pad = normalizePadId(n.pad);
    if (!pad) {
      dropped.add(n.pad);
      continue;
    }
    const note: ChartNote = { timeMs: n.timeMs, pad, noteId: n.noteId };
    if (pad === 'HIHAT' && n.hihatOpen === true) note.hihatOpen = true;
    if (n.velocityHint != null) note.velocityHint = n.velocityHint;
    notes.push(note);
  }
  if (dropped.size > 0) {
    console.warn(`알 수 없는 pad 노트를 버렸습니다: ${[...dropped].join(', ')}`);
  }

  const barMs = (60_000 / detail.bpm) * detail.beatsPerBar;
  const lastMs = notes.reduce((m, n) => Math.max(m, n.timeMs), 0);
  const durationMs = detail.durationMs ?? Math.round(lastMs + barMs);

  const tempoCount = detail.timing?.tempoMap?.length ?? 0;
  const sigCount = detail.timing?.timeSignatureMap?.length ?? 0;

  const chart: Chart = {
    songId: String(songNumericId),
    title: detail.title,
    difficulty: detail.difficulty,
    bpm: detail.bpm,
    offsetMs: detail.offsetMs,
    beatsPerBar: detail.beatsPerBar,
    notes,
    source: detail.source,
    durationMs,
    chartVersionId,
    chartId,
    songNumericId,
    hasAccompaniment,
    sourceNoteCount: detail.noteCount,
  };
  const segments = tempoSegmentsFrom(detail.offsetMs, detail.timing?.ppq, detail.timing?.tempoMap);
  if (segments) chart.tempoSegments = segments;
  // 악보 화면은 빠르기 구간을 따라 그린다(CHART-003-variable-tempo-exp). 박자 변화나 구간을 못 만든 tempoMap만 고정 bpm 안내
  if (sigCount > 1 || (tempoCount > 1 && !segments)) chart.variableTempo = true;
  return chart;
}
