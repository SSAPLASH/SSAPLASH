// 약점 구간 재생 일정 계산(순수). Web Audio를 모른다 — 실제 예약은 audio/SegmentPlayer가 한다.
import type { PadId } from '@/domain/kit/pads';
import type { PlayLog } from '@/domain/play/playLog';
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

/** 내가 친 타격 한 번. 구간 소속은 anchorMs로, 재생 위치는 timeMs로 정한다 */
export interface PlayedHit {
  /** 타격의 곡 시각(ms) */
  timeMs: number;
  /** 구간 소속 기준 시각. 짝지어진 노트의 시각, 헛친 타격은 timeMs와 같다 */
  anchorMs: number;
  pad: PadId;
  /** 세기 1~127 */
  velocity: number;
}

/** 내 타격 목록의 재료: 이 브라우저의 연주 기록 / 서버 리포트 노트 */
export type PlayedSource = 'LOG' | 'NOTES';

/** 화면이 확대 영역에 내려주는 내 타격 목록(시각순) */
export interface PlayedHits {
  hits: PlayedHit[];
  source: PlayedSource;
}

function validRate(rate: number): number {
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

/**
 * 연주 기록에서 내 타격을 뽑는다. 판정된 타격은 「노트 시각 + 오차 × 배율」, 헛친 타격은 기록된 곡 시각을 쓴다.
 * 패드가 없는 타격과 곡 시각이 없는 헛친 타격은 뺀다.
 */
export function playedHitsFromLog(log: Pick<PlayLog, 'hits' | 'notes' | 'playbackRate'>): PlayedHit[] {
  const rate = validRate(log.playbackRate ?? 1);
  const out: PlayedHit[] = [];
  for (const h of log.hits) {
    if (h.pad === null) continue;
    const note = h.matchedNoteIndex !== undefined ? log.notes[h.matchedNoteIndex] : undefined;
    if (h.judgement && h.deltaMs !== undefined && note) {
      out.push({ timeMs: note.timeMs + h.deltaMs * rate, anchorMs: note.timeMs, pad: h.pad, velocity: clampVelocity(h.velocity) });
    } else if (h.tSongMs !== undefined && Number.isFinite(h.tSongMs) && h.tSongMs >= 0) {
      out.push({ timeMs: h.tSongMs, anchorMs: h.tSongMs, pad: h.pad, velocity: clampVelocity(h.velocity) });
    }
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/** 서버 리포트 노트에서 내 타격을 뽑는다. PERFECT·GOOD이고 오차가 있는 노트만(MISS는 소리 없음) */
export function playedHitsFromNotes(notes: readonly ReportNote[], rate: number): PlayedHit[] {
  const r = validRate(rate);
  const out: PlayedHit[] = [];
  for (const n of notes) {
    if ((n.judgement !== 'PERFECT' && n.judgement !== 'GOOD') || n.deltaMs === null) continue;
    out.push({ timeMs: n.timeMs + n.deltaMs * r, anchorMs: n.timeMs, pad: n.pad, velocity: clampVelocity(n.velocity ?? SEGMENT_NOTE_VELOCITY) });
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * 구간(fromMs ≤ anchorMs < toMs)의 내 타격을 재생 일정으로 바꾼다.
 * 구간 앞에서 일찍 친 타격이 잘리지 않게 재생 시작·끝을 타격 시각까지 넓히고, plan의 fromMs·toMs는 그 넓힌 값이다(반주 시작 위치).
 */
export function planPlayed(hits: readonly PlayedHit[], fromMs: number, toMs: number, rate: number): SegmentPlan {
  const r = validRate(rate);
  const inside = hits.filter((h) => h.anchorMs >= fromMs && h.anchorMs < toMs);
  if (inside.length === 0) return { events: [], lengthMs: (toMs - fromMs) / r, fromMs, toMs };
  // 연주 전체 구간은 타격이 수천 개일 수 있어 인자 펼치기 대신 순회한다
  let start = fromMs;
  let end = toMs;
  for (const h of inside) {
    if (h.timeMs < start) start = h.timeMs;
    if (h.timeMs > end) end = h.timeMs;
  }
  const events = inside.map((h) => ({ atMs: (h.timeMs - start) / r, pad: h.pad, velocity: h.velocity })).sort((a, b) => a.atMs - b.atMs);
  return { events, lengthMs: (end - start) / r, fromMs: start, toMs: end };
}
