// 리포트 화면용 계산 (설계 COACH-002 리포트 화면 개편 3장). React·DOM·네트워크를 모르는 순수 함수.
// 노트 목록을 5초 칸으로 묶고, AI 약점을 화면 자리(놓친 구간·패드 전환·그 밖)로 나누고, 확대해서 볼 구간(Focus)과 그 문구를 만든다.
// 약점 문구는 서버 값을 그대로 쓰고, 숫자(metrics)는 있으면 쓰고 없으면 그 문구만 뺀다(D5).
import { PAD_META, type PadId } from '@/domain/kit/pads';
import type { PadStat, ReportNote, WeakSegment } from '@/domain/play/report';

/** 전체 노트 흐름의 칸 폭(ms) */
export const FLOW_BIN_MS = 5000;
/** 패드 전환 「예시 보기」가 여는 창 길이(ms) */
export const TRANSITION_WINDOW_MS = 8000;
/** 패드별 기록 표에서 접지 않고 보이는 줄 수 */
export const PAD_MAIN_ROWS = 3;

/**
 * 리포트 화면의 노트 구분(설계 COACH-002-report-timing-direction D3). 판정의 GOOD을 오차 부호로 나눈다 —
 * 「타이밍이 어긋났다」가 아니라 빨랐는지 늦었는지를 보인다. 놓침은 오차가 없어 방향을 알 수 없다
 */
export type NoteVerdict = 'PERFECT' | 'EARLY' | 'LATE' | 'MISS';

/** 구분의 화면 이름 */
export const VERDICT_LABEL: Record<NoteVerdict, string> = { PERFECT: '정확', EARLY: '빠름', LATE: '늦음', MISS: '놓침' };

/** 5초 막대 범례에서 빠름·늦음을 한 색으로 묶은 이름(D5 — 막대는 색 3개 그대로다) */
export const OFF_BEAT_LABEL = `${VERDICT_LABEL.EARLY}·${VERDICT_LABEL.LATE}`;

/** GOOD이고 오차가 음수면 빠름, GOOD의 나머지는 늦음(오차가 0이거나 없는 GOOD은 서버 계약상 오지 않는다) */
export function noteVerdict(n: Pick<ReportNote, 'judgement' | 'deltaMs'>): NoteVerdict {
  if (n.judgement !== 'GOOD') return n.judgement;
  return n.deltaMs !== null && n.deltaMs < 0 ? 'EARLY' : 'LATE';
}

/** 구분별 노트 수 */
export function verdictCounts(notes: readonly Pick<ReportNote, 'judgement' | 'deltaMs'>[]): Record<NoteVerdict, number> {
  const counts: Record<NoteVerdict, number> = { PERFECT: 0, EARLY: 0, LATE: 0, MISS: 0 };
  for (const n of notes) counts[noteVerdict(n)] += 1;
  return counts;
}

const safe = (ms: number) => (Number.isFinite(ms) && ms > 0 ? ms : 0);
const two = (n: number) => String(n).padStart(2, '0');

/** ms → 「0:12.3」(0.1초 내림). 딱 떨어지면 「0:46」 */
export function clockTenth(ms: number): string {
  const tenths = Math.floor(safe(ms) / 100);
  const sec = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return `${Math.floor(sec / 60)}:${two(sec % 60)}${frac === 0 ? '' : `.${frac}`}`;
}

/** ms → 「0:13.34」(0.01초 반올림, 항상 두 자리) */
export function clockHundredth(ms: number): string {
  const cs = Math.round(safe(ms) / 10);
  const rem = cs % 6000;
  return `${Math.floor(cs / 6000)}:${two(Math.floor(rem / 100))}.${two(rem % 100)}`;
}

/** ms → 「0:12」(초 내림) */
export function clockSecond(ms: number): string {
  const sec = Math.floor(safe(ms) / 1000);
  return `${Math.floor(sec / 60)}:${two(sec % 60)}`;
}

/** 구간 → 「0:12–0:17」 */
export function clockRange(fromMs: number, toMs: number): string {
  return `${clockSecond(fromMs)}–${clockSecond(toMs)}`;
}

/** 오차 → 「39ms 빠름」·「13ms 늦음」·「정시」. 없으면 빈 글자 */
export function deltaText(deltaMs: number | null): string {
  if (deltaMs === null || !Number.isFinite(deltaMs)) return '';
  const abs = Math.round(Math.abs(deltaMs));
  if (abs === 0) return '정시';
  return `${abs}ms ${deltaMs < 0 ? '빠름' : '늦음'}`;
}

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

// ---- 전체 노트 흐름 ----

export interface FlowBin {
  fromMs: number;
  perfect: number;
  /** 빠름 + 늦음(막대의 한 토막) */
  good: number;
  /** good 중 박보다 빨리 친 수 */
  early: number;
  /** good 중 박보다 늦게 친 수 */
  late: number;
  miss: number;
}

/** 시간축 길이(ms). 곡 길이와 마지막 노트 중 긴 쪽을 5초 단위로 올린다. 최소 한 칸 */
export function flowTotalMs(notes: readonly ReportNote[], durationMs: number | null): number {
  const last = notes.reduce((m, n) => Math.max(m, n.timeMs + 1), 0);
  const span = Math.max(safe(durationMs ?? 0), last);
  return Math.max(1, Math.ceil(span / FLOW_BIN_MS)) * FLOW_BIN_MS;
}

/** 노트를 5초 칸으로 묶는다(시작 포함, 끝 미포함). 축 밖 노트는 양 끝 칸에 넣는다 */
export function flowBins(notes: readonly ReportNote[], totalMs: number): FlowBin[] {
  const count = Math.max(1, Math.ceil(totalMs / FLOW_BIN_MS));
  const bins: FlowBin[] = Array.from({ length: count }, (_, i) => ({ fromMs: i * FLOW_BIN_MS, perfect: 0, good: 0, early: 0, late: 0, miss: 0 }));
  for (const n of notes) {
    const bin = bins[Math.min(count - 1, Math.max(0, Math.floor(n.timeMs / FLOW_BIN_MS)))];
    const verdict = noteVerdict(n);
    if (verdict === 'PERFECT') bin.perfect += 1;
    else if (verdict === 'MISS') bin.miss += 1;
    else {
      bin.good += 1;
      if (verdict === 'EARLY') bin.early += 1;
      else bin.late += 1;
    }
  }
  return bins;
}

export const binTotal = (b: FlowBin) => b.perfect + b.good + b.miss;

/** 구간 안 노트(시작 포함, 끝 미포함) */
export function notesInRange(notes: readonly ReportNote[], fromMs: number, toMs: number): ReportNote[] {
  return notes.filter((n) => n.timeMs >= fromMs && n.timeMs < toMs);
}

// ---- 약점 나누기 ----

export interface SegmentGroups {
  /** 놓친 노트가 모인 구간(MISS_CLUSTER, 시각순) */
  clusters: WeakSegment[];
  /** 패드 전환(TRANSITION_MISS·TRANSITION_LATE, 서버 순서) */
  transitions: WeakSegment[];
  /** 그 밖(연주 전체 먼저, 서버 순서) */
  others: WeakSegment[];
}

const isTransition = (s: WeakSegment) => (s.pattern === 'TRANSITION_MISS' || s.pattern === 'TRANSITION_LATE') && s.pads.length >= 2;
const isCluster = (s: WeakSegment) => s.pattern === 'MISS_CLUSTER' && s.scope === 'SEGMENT';

export function splitSegments(segments: readonly WeakSegment[] | null): SegmentGroups {
  const all = segments ?? [];
  const rest = all.filter((s) => !isCluster(s) && !isTransition(s));
  return {
    clusters: all.filter(isCluster).sort((a, b) => a.fromMs - b.fromMs),
    transitions: all.filter(isTransition),
    others: [...rest.filter((s) => s.scope === 'WHOLE'), ...rest.filter((s) => s.scope !== 'WHOLE')],
  };
}

/** metrics의 숫자 값. 없거나 숫자가 아니면 null */
export function metricNumber(seg: WeakSegment, key: string): number | null {
  const v = seg.metrics[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const padLabel = (pad: PadId) => PAD_META[pad]?.label ?? pad;
const transitionLabel = (seg: WeakSegment) => `${padLabel(seg.pads[0])} → ${padLabel(seg.pads[1])}`;

function missText(unit: '개' | '번', head: string, total: number, missed: number, rate: number | null): string {
  const r = rate ?? (total > 0 ? missed / total : 0);
  return `${head}${total}${unit} 중 ${missed}${unit} 놓침 · ${percent(r)}`;
}

/** 전환 약점의 숫자 문구. 숫자가 없으면 null */
function transitionCountText(seg: WeakSegment): string | null {
  const times = metricNumber(seg, 'transitionCount');
  if (times === null) return null;
  if (seg.pattern === 'TRANSITION_MISS') {
    const missed = metricNumber(seg, 'missCount');
    return missed === null ? null : missText('번', '전환 ', times, missed, metricNumber(seg, 'missRate'));
  }
  const mean = metricNumber(seg, 'meanDeltaMs');
  return mean === null ? null : `전환 ${times}번 · 평균 ${deltaText(mean)}`;
}

/** 관찰 목록 한 줄(패드 전환 관찰·그 밖의 관찰) */
export function observationText(seg: WeakSegment): { label: string; count: string } {
  if (isTransition(seg)) return { label: transitionLabel(seg), count: transitionCountText(seg) ?? seg.description };
  return { label: seg.description, count: seg.scope === 'WHOLE' ? '연주 전체' : clockRange(seg.fromMs, seg.toMs) };
}

/**
 * 전환 예시로 열 8초 창. 그 전환 노트(시간순으로 바로 앞 노트가 이전 패드이고 자신이 다음 패드)가 가장 많이 든 위치를 고른다.
 * missOnly면 놓친 전환만 세되, 놓친 전환이 없으면 전체 전환으로 센다. 같으면 가장 이른 곳. 시작은 초 단위로 내린다.
 * 전환 노트가 없으면 약점 구간의 앞 8초.
 */
export function transitionWindow(notes: readonly ReportNote[], seg: WeakSegment, missOnly: boolean): { fromMs: number; toMs: number } {
  const [prev, cur] = seg.pads;
  const all: { time: number; start: number; miss: boolean }[] = [];
  for (let i = 1; i < notes.length; i++) {
    if (notes[i - 1].pad === prev && notes[i].pad === cur && prev !== cur) {
      all.push({ time: notes[i].timeMs, start: Math.max(0, Math.floor(notes[i - 1].timeMs / 1000) * 1000), miss: notes[i].judgement === 'MISS' });
    }
  }
  const missed = all.filter((t) => t.miss);
  const pool = missOnly && missed.length > 0 ? missed : all;
  if (pool.length === 0) return { fromMs: seg.fromMs, toMs: Math.min(seg.toMs, seg.fromMs + TRANSITION_WINDOW_MS) };
  let best = pool[0].start;
  let bestCount = 0;
  for (const c of pool) {
    const count = pool.filter((t) => t.time >= c.start && t.time < c.start + TRANSITION_WINDOW_MS).length;
    if (count > bestCount || (count === bestCount && c.start < best)) {
      best = c.start;
      bestCount = count;
    }
  }
  return { fromMs: best, toMs: best + TRANSITION_WINDOW_MS };
}

// ---- 패드별 기록 ----

const statTotal = (s: PadStat) => s.counts.PERFECT + s.counts.GOOD + s.counts.MISS;
export const padStatTotal = statTotal;

/** 노트 수 상위 3개를 정확도 낮은 순으로 보이고, 나머지는 노트 수 많은 순으로 접는다 */
export function padRows(stats: readonly PadStat[]): { main: PadStat[]; more: PadStat[] } {
  const byTotal = [...stats].sort((a, b) => statTotal(b) - statTotal(a));
  const acc = (s: PadStat) => s.accuracy ?? Number.POSITIVE_INFINITY;
  return {
    main: byTotal.slice(0, PAD_MAIN_ROWS).sort((a, b) => acc(a) - acc(b)),
    more: byTotal.slice(PAD_MAIN_ROWS),
  };
}

// ---- 확대해서 볼 구간 ----

export type FocusKind = 'cluster' | 'transition' | 'segment' | 'bin';

export interface Focus {
  kind: FocusKind;
  /** 구간 식별 글자(선택 비교·재생 키) */
  key: string;
  /** 확대 창 */
  fromMs: number;
  toMs: number;
  /** 고른 약점. 막대 칸이면 null */
  segment: WeakSegment | null;
  /** 굵게 표시할 패드 줄 */
  relatedPads: PadId[];
}

const keyOf = (kind: FocusKind, fromMs: number, toMs: number, pattern = '') => `${kind}:${fromMs}:${toMs}:${pattern}`;

export function focusOfCluster(seg: WeakSegment): Focus {
  return { kind: 'cluster', key: keyOf('cluster', seg.fromMs, seg.toMs, seg.pattern), fromMs: seg.fromMs, toMs: seg.toMs, segment: seg, relatedPads: [...seg.pads] };
}

export function focusOfTransition(seg: WeakSegment, notes: readonly ReportNote[]): Focus {
  const w = transitionWindow(notes, seg, seg.pattern === 'TRANSITION_MISS');
  // 키는 창이 아니라 약점으로 만든다(같은 약점은 같은 선택)
  return { kind: 'transition', key: `transition:${seg.pattern}:${seg.pads.join('>')}`, fromMs: w.fromMs, toMs: w.toMs, segment: seg, relatedPads: [seg.pads[0], seg.pads[1]] };
}

/** 그 밖의 약점 중 구간이 있는 것 */
export function focusOfSegment(seg: WeakSegment): Focus {
  return { kind: 'segment', key: keyOf('segment', seg.fromMs, seg.toMs, seg.pattern), fromMs: seg.fromMs, toMs: seg.toMs, segment: seg, relatedPads: [...seg.pads] };
}

export function focusOfBin(fromMs: number): Focus {
  return { kind: 'bin', key: keyOf('bin', fromMs, fromMs + FLOW_BIN_MS), fromMs, toMs: fromMs + FLOW_BIN_MS, segment: null, relatedPads: [] };
}

/** 처음 선택: 첫 놓친 구간 → 첫 전환 → 놓침이 가장 많은 칸(같으면 이른 칸) → 노트가 없으면 null */
export function initialFocus(groups: SegmentGroups, notes: readonly ReportNote[], totalMs: number): Focus | null {
  if (groups.clusters.length > 0) return focusOfCluster(groups.clusters[0]);
  if (groups.transitions.length > 0) return focusOfTransition(groups.transitions[0], notes);
  if (notes.length === 0) return null;
  const bins = flowBins(notes, totalMs);
  let best = bins.find((b) => binTotal(b) > 0) ?? bins[0];
  for (const b of bins) if (b.miss > best.miss) best = b;
  return focusOfBin(best.fromMs);
}

/** 확대 영역 큰 제목 두 줄 */
export function focusHeadline(focus: Focus): [string, string] {
  if (focus.kind === 'transition' && focus.segment) return [transitionLabel(focus.segment), '전환 연습'];
  const range = clockRange(focus.fromMs, focus.toMs);
  if (focus.kind === 'cluster') return [range, '놓친 노트 확인'];
  if (focus.kind === 'segment') return [range, '구간 확인'];
  return [range, '노트 확인'];
}

/** 확대 영역 근거 한 줄. 노트를 아직 못 받았고 서버 숫자도 없으면 빈 글자 */
export function focusBasis(focus: Focus, notes: readonly ReportNote[] | null): string {
  const seg = focus.segment;
  if (focus.kind === 'transition' && seg) return transitionCountText(seg) ?? '';
  if (focus.kind === 'cluster' && seg) {
    const total = metricNumber(seg, 'noteCount');
    const missed = metricNumber(seg, 'missCount');
    if (total !== null && missed !== null) return missText('개', '노트 ', total, missed, metricNumber(seg, 'missRate'));
  }
  if (notes === null) return '';
  const inRange = notesInRange(notes, focus.fromMs, focus.toMs);
  if (inRange.length === 0) return '';
  return missText('개', '노트 ', inRange.length, inRange.filter((n) => n.judgement === 'MISS').length, null);
}
