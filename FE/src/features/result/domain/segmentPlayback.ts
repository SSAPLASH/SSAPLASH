// 약점 구간 재생 일정 계산(순수). Web Audio를 모른다 — 실제 예약은 audio/SegmentPlayer가 한다.
import type { PadId } from '@/domain/kit/pads';
import type { ReportNote } from '@/domain/play/report';

export interface SegmentEvent {
  /** 구간 시작을 0으로 한 상대 시각(ms). 배속이 반영돼 있다 */
  atMs: number;
  pad: PadId;
  velocity: number;
}

export interface SegmentPlan {
  events: SegmentEvent[];
  /** 배속을 반영한 구간 길이(ms) */
  lengthMs: number;
  /** 원곡 기준 구간 시작·끝(ms). 반주를 이 위치부터 재생한다 */
  fromMs: number;
  toMs: number;
}

/** 리포트 노트에는 세기가 없으므로 채보 재생 음량을 고정한다 */
export const SEGMENT_NOTE_VELOCITY = 90;
/** 반복 재생에서 구간 끝과 다음 시작 사이 쉬는 시간(ms) */
export const SEGMENT_LOOP_GAP_MS = 300;

/**
 * 구간(fromMs ≤ timeMs < toMs)의 노트를 재생 일정으로 바꾼다. 판정(MISS 포함)과 무관하게 정답을 모두 넣는다.
 * rate가 0 이하이거나 유한수가 아니면 1로 본다.
 */
export function planSegment(notes: readonly ReportNote[], fromMs: number, toMs: number, rate: number): SegmentPlan {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const events = notes
    .filter((n) => n.timeMs >= fromMs && n.timeMs < toMs)
    .map((n) => ({ atMs: (n.timeMs - fromMs) / r, pad: n.pad, velocity: SEGMENT_NOTE_VELOCITY }))
    .sort((a, b) => a.atMs - b.atMs);
  return { events, lengthMs: (toMs - fromMs) / r, fromMs, toMs };
}
