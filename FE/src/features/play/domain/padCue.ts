// 패드 큐: 마디·판정 상태에서 패드별 "다음 박 라벨"과 강조 단계를 계산한다. 그리기·시계는 모른다.
import type { ChartNote } from '@/domain/song/chart';
import type { PadBadge } from '@/domain/kit/drumKit';
import type { Judgement } from '@/domain/play/judgement';
import type { PadId } from '@/domain/kit/pads';
import { countLabel, type SheetModel } from '@/domain/song/sheet';

/** 큐 계산에 쓰는 음표 판정 상태. engine의 NoteState가 이 모양을 그대로 만족한다 */
export interface CueNoteState {
  note: Pick<ChartNote, 'timeMs'>;
  judgement: Judgement | null;
}

export interface PadCue {
  pad: PadId;
  label: ReturnType<typeof countLabel>;
  /** 대상 음표의 chart.notes 인덱스 */
  noteIndex: number;
  /** 대상 음표 시각(ms) */
  timeMs: number;
  /** next: 마디에서 가장 먼저 칠 음(동시타면 여러 패드), later: 그 뒤 */
  level: 'next' | 'later';
  /** 대상 칸이 격자 밖(라벨은 가장 가까운 칸, 배지에 점) */
  offGrid: boolean;
}

/** bar 마디에서 아직 판정되지 않은 칸 중 패드마다 가장 이른 칸 하나를 큐로 만든다 */
export function padCues(sheet: SheetModel, bar: number, notes: readonly CueNoteState[]): PadCue[] {
  const cells = sheet.bars[bar]?.cells;
  if (!cells) return [];

  const earliest = new Map<PadId, { step: number; noteIndex: number; offGrid: boolean }>();
  for (const c of cells) {
    if (notes[c.noteIndex]?.judgement !== null) continue;
    const cur = earliest.get(c.pad);
    if (!cur || c.step < cur.step || (c.step === cur.step && c.noteIndex < cur.noteIndex)) {
      earliest.set(c.pad, { step: c.step, noteIndex: c.noteIndex, offGrid: c.offGrid });
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
    offGrid: e.offGrid,
  }));
}

/** "지금" 판정 허용 오차(ms). 한 프레임 안팎 */
export const NOW_TOLERANCE_MS = 17;

/** 배지에 쓰는 박 라벨 문자열 ("1", "1e", "1&", "1a") */
export function cueLabelText(label: PadCue['label']): string {
  return `${label.beat}${label.sub}`;
}

export interface NextBeatBadges {
  /** 패드별 배지 (DrumKit badges 형식): 라벨 · level(now/next/later) · 격자 밖 점 */
  badges: Partial<Record<PadId, PadBadge>>;
  /** 곡 시각이 칠 시각(±허용 오차)에 닿은 패드들 */
  nowPads: PadId[];
  /** DrumKit highlight용 한 패드(배지 level로 이미 강조되므로 badges와 함께 넘길 필요는 없다): "지금" 패드가 있으면 그것, 없으면 마디에서 가장 먼저 칠 패드(level next) */
  highlight?: PadId;
}

/** 패드 큐 → 킷 배지·강조. songTimeMs는 원본 timeMs와 같은 기준(곡 시각) */
export function nextBeatBadges(cues: readonly PadCue[], songTimeMs: number): NextBeatBadges {
  const badges: Partial<Record<PadId, PadBadge>> = {};
  const nowPads: PadId[] = [];
  let firstNext: PadId | undefined;
  for (const c of cues) {
    const isNow = Math.abs(c.timeMs - songTimeMs) <= NOW_TOLERANCE_MS;
    badges[c.pad] = { text: cueLabelText(c.label), level: isNow ? 'now' : c.level, offGrid: c.offGrid };
    if (isNow) nowPads.push(c.pad);
    if (c.level === 'next' && firstNext === undefined) firstNext = c.pad;
  }
  return { badges, nowPads, highlight: nowPads[0] ?? firstNext };
}
