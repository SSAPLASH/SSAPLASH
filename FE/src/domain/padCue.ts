// 패드 큐: 마디·판정 상태에서 패드별 "다음 박 라벨"과 강조 단계를 계산한다. 그리기·시계는 모른다.
import type { NoteState } from '@/engine/RhythmSession';
import type { PadId } from './pads';
import { countLabel, type SheetModel } from './sheet';

export interface PadCue {
  pad: PadId;
  label: ReturnType<typeof countLabel>;
  /** 대상 음표의 chart.notes 인덱스 */
  noteIndex: number;
  /** 대상 음표 시각(ms) */
  timeMs: number;
  /** next: 마디에서 가장 먼저 칠 음(동시타면 여러 패드), later: 그 뒤 */
  level: 'next' | 'later';
}

/** bar 마디에서 아직 판정되지 않은 칸 중 패드마다 가장 이른 칸 하나를 큐로 만든다 */
export function padCues(sheet: SheetModel, bar: number, notes: NoteState[]): PadCue[] {
  const cells = sheet.bars[bar]?.cells;
  if (!cells) return [];

  const earliest = new Map<PadId, { step: number; noteIndex: number }>();
  for (const c of cells) {
    if (notes[c.noteIndex]?.judgement !== null) continue;
    const cur = earliest.get(c.pad);
    if (!cur || c.step < cur.step || (c.step === cur.step && c.noteIndex < cur.noteIndex)) {
      earliest.set(c.pad, { step: c.step, noteIndex: c.noteIndex });
    }
  }
  if (earliest.size === 0) return [];

  const minStep = Math.min(...[...earliest.values()].map((e) => e.step));
  return [...earliest].map(([pad, e]) => ({
    pad,
    label: countLabel(e.step, sheet.stepsPerBar, sheet.beatsPerBar),
    noteIndex: e.noteIndex,
    timeMs: notes[e.noteIndex].note.timeMs,
    level: e.step === minStep ? 'next' : 'later',
  }));
}
