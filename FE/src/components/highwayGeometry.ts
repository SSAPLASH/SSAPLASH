// 하이웨이 위치 계산 — 레인·판정선·노트 y. NoteHighway의 그리기 루프와 이펙트 위치 찾기(locate)가 같은 식을 쓰도록 순수 함수로 뺐다.
import type { FxEvent, FxGeo, FxLocation } from '@/domain/hitFx/types';
import type { PadId } from '@/domain/pads';

/** 판정선은 캔버스 아래에서 이만큼 위 */
export const JUDGE_FROM_BOTTOM = 90;
/** 노트가 나타나는 위쪽 여백 */
export const HIGHWAY_TOP = 30;
/** 판정선 이펙트 세로 반지름(px) */
export const LANE_FX_RY = 12;

export interface HighwayLayout {
  laneW: number;
  judgeY: number;
  top: number;
  /** 위 여백에서 판정선까지의 거리 */
  travel: number;
}

export function highwayLayout(width: number, height: number, laneCount: number): HighwayLayout {
  const judgeY = height - JUDGE_FROM_BOTTOM;
  return { laneW: width / Math.max(1, laneCount), judgeY, top: HIGHWAY_TOP, travel: judgeY - HIGHWAY_TOP };
}

/** 노트 y: dtMs = 노트 시각 − 현재 곡 시각. 0이면 판정선, 양수면 위, 음수면 아래 */
export function noteY(layout: HighwayLayout, dtMs: number, scrollMs: number): number {
  return layout.judgeY - (dtMs / scrollMs) * layout.travel;
}

export function laneCenterX(layout: HighwayLayout, laneIndex: number): number {
  return laneIndex * layout.laneW + layout.laneW / 2;
}

/** 레인 가운데 × y 의 이펙트 기하: rx = 레인 폭 0.4, ry = 12 */
export function laneFxGeo(layout: HighwayLayout, laneIndex: number, y: number): FxGeo {
  return { cx: laneCenterX(layout, laneIndex), cy: y, rx: layout.laneW * 0.4, ry: LANE_FX_RY, k: 1 };
}

export interface HighwayLocateInput {
  width: number;
  height: number;
  lanes: readonly PadId[];
  /** 노트 번호 → 노트 패드·시각. 없으면 undefined */
  noteOf: (noteIndex: number) => { pad: PadId; timeMs: number } | undefined;
  /** 지금 곡 시각(ms) */
  songTime: number;
  scrollMs: number;
  /** 패드 → 깨짐 파편 색 */
  tintOf: (pad: PadId) => string;
}

/**
 * 이벤트 → 하이웨이 위치. PERFECT·GOOD은 레인 가운데 × 판정선, MISS는 그 노트의 현재 y(깨짐).
 * 판정이 없는 이벤트(자유 연주·헛침)·레인에 없는 패드·모르는 노트는 null(이펙트 없음)
 */
export function locateHighway(event: FxEvent, input: HighwayLocateInput): FxLocation | null {
  const j = event.judgement;
  if (event.stray || j === null || event.noteIndex === undefined || event.noteIndex === null) return null;
  if (input.width <= 0 || input.height <= 0) return null;
  const note = input.noteOf(event.noteIndex);
  if (!note) return null;
  const li = input.lanes.indexOf(note.pad);
  if (li < 0) return null;
  const layout = highwayLayout(input.width, input.height, input.lanes.length);
  if (j === 'MISS') {
    return { geo: laneFxGeo(layout, li, noteY(layout, note.timeMs - input.songTime, input.scrollMs)), shape: 'lane', tint: input.tintOf(note.pad) };
  }
  return { geo: laneFxGeo(layout, li, layout.judgeY), shape: 'lane' };
}
