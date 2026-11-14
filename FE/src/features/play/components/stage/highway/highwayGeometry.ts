// 하이웨이 위치 계산 — 레인·판정선·노트 y. NoteHighway의 그리기 루프와 이펙트 위치 찾기(locate)가 같은 식을 쓰도록 순수 함수로 뺐다.
import type { FxEvent, FxGeo, FxLocation } from '@/domain/hitFx/types';
import type { PadId } from '@/domain/kit/pads';

/** 판정선은 캔버스 아래에서 이만큼 위. 판정선 아래는 레인 → 패드 연결 구역이다(link/laneLinkGeometry의 LINK_ZONE_H) */
export const JUDGE_FROM_BOTTOM = 80;
/** 노트가 나타나는 위쪽 여백 */
export const HIGHWAY_TOP = 30;
/** 판정선 이펙트 세로 반지름(px) */
export const LANE_FX_RY = 12;

/** 첫 칸(하이햇 페달)과 나머지 칸 사이를 띄우는 간격(px). 칸이 둘 이상일 때만 적용한다 */
export const HIGHWAY_PEDAL_GAP = 16;

export interface HighwayLayout {
  laneW: number;
  /** 첫 칸 뒤 간격(칸이 하나면 0) */
  gap: number;
  judgeY: number;
  top: number;
  /** 위 여백에서 판정선까지의 거리 */
  travel: number;
}

export function highwayLayout(width: number, height: number, laneCount: number): HighwayLayout {
  const judgeY = height - JUDGE_FROM_BOTTOM;
  const gap = laneCount > 1 ? HIGHWAY_PEDAL_GAP : 0;
  return { laneW: (width - gap) / Math.max(1, laneCount), gap, judgeY, top: HIGHWAY_TOP, travel: judgeY - HIGHWAY_TOP };
}

/** 칸 i의 왼쪽 x: i × 칸 폭 + (첫 칸 뒤라면 간격). 하이웨이의 모든 x 계산이 이 함수를 쓴다 */
export function laneLeft(layout: HighwayLayout, laneIndex: number): number {
  return laneIndex * layout.laneW + (laneIndex >= 1 ? layout.gap : 0);
}

/** 노트 y: dtMs = 노트 시각 − 현재 곡 시각. 0이면 판정선, 양수면 위, 음수면 아래 */
export function noteY(layout: HighwayLayout, dtMs: number, scrollMs: number): number {
  return layout.judgeY - (dtMs / scrollMs) * layout.travel;
}

export function laneCenterX(layout: HighwayLayout, laneIndex: number): number {
  return laneLeft(layout, laneIndex) + layout.laneW / 2;
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
