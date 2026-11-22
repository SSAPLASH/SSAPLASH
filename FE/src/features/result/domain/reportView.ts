// 리포트 화면용 계산 (설계 COACH-002 리포트 화면 개편 3장). React·DOM·네트워크를 모르는 순수 함수.
// 노트 목록을 5초 칸으로 묶고, AI 약점을 화면 자리(놓친 구간·패드 전환·그 밖)로 나누고, 확대해서 볼 구간(Focus)과 그 문구를 만든다.
// 약점 문구는 서버 값을 그대로 쓰고, 숫자(metrics)는 있으면 쓰고 없으면 그 문구만 뺀다(D5).
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { FULL_ANALYSIS_MIN_NOTES, segmentBars, type AnalysisStatus, type CoachSummary, type PadStat, type ReportNote, type WeakSegment } from '@/domain/play/report';

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

/**
 * 구간을 마디로 세는 데 쓰는 값(D9). 리포트 응답에는 BPM이 없어 이 브라우저의 연주 기록에서 만든다.
 * 위치가 곡 시각이므로 연습 속도로 친 기록도 원래 BPM으로 세면 된다. 빠르기가 바뀌는 곡은 근사값이다(결과 화면의 약점 마디와 같은 식)
 */
export interface ReportGrid {
  bpm: number;
  /** 한 마디의 박 수 */
  beatsPerBar: number;
  /** 격자 원점(1마디 1박, ms) */
  originMs: number;
}

/** 연주 기록 → 마디 격자. 기록이 없거나 BPM·박자가 양수가 아니면 null(시각만 보인다) */
export function reportGrid(log: { bpm?: number; beatsPerBar?: number; offsetMs?: number } | null | undefined): ReportGrid | null {
  if (!log) return null;
  const { bpm, beatsPerBar } = log;
  if (typeof bpm !== 'number' || typeof beatsPerBar !== 'number' || !(bpm > 0) || !(beatsPerBar > 0)) return null;
  return { bpm, beatsPerBar, originMs: typeof log.offsetMs === 'number' && Number.isFinite(log.offsetMs) ? log.offsetMs : 0 };
}

/** 구간 → 「7~9마디」·「3마디」(1부터). 격자가 없으면 null */
export function barsText(fromMs: number, toMs: number, grid: ReportGrid | null): string | null {
  const bars = grid ? segmentBars(fromMs, toMs, grid.bpm, grid.beatsPerBar, grid.originMs) : null;
  if (!bars) return null;
  const [from, to] = bars;
  return from === to ? `${from + 1}마디` : `${from + 1}~${to + 1}마디`;
}

/** 구간 글자 앞에 마디를 붙인다: 「7~9마디 · 0:12–0:17」(D8). 격자가 없으면 시각 글자 그대로 */
export function withBars(clock: string, fromMs: number, toMs: number, grid: ReportGrid | null): string {
  const bars = barsText(fromMs, toMs, grid);
  return bars === null ? clock : `${bars} · ${clock}`;
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

/** 관찰 목록 한 줄(패드 전환 관찰·그 밖의 관찰). 구간이 있는 약점은 격자가 있으면 마디를 앞에 붙인다 */
export function observationText(seg: WeakSegment, grid: ReportGrid | null = null): { label: string; count: string } {
  if (isTransition(seg)) return { label: transitionLabel(seg), count: transitionCountText(seg) ?? seg.description };
  return { label: seg.description, count: seg.scope === 'WHOLE' ? '연주 전체' : withBars(clockRange(seg.fromMs, seg.toMs), seg.fromMs, seg.toMs, grid) };
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

/** 확대 구간 글자: 「7~9마디 · 0:12–0:17」, 격자가 없으면 「0:12–0:17」 */
export function focusRangeText(focus: Pick<Focus, 'fromMs' | 'toMs'>, grid: ReportGrid | null): string {
  return withBars(clockRange(focus.fromMs, focus.toMs), focus.fromMs, focus.toMs, grid);
}

/** 확대 영역 큰 제목 두 줄 */
export function focusHeadline(focus: Focus, grid: ReportGrid | null = null): [string, string] {
  if (focus.kind === 'transition' && focus.segment) return [transitionLabel(focus.segment), '전환 연습'];
  const range = focusRangeText(focus, grid);
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

/**
 * 코치 총평을 헤드라인(첫 문장)과 나머지로 나눈다(설계 COACH-002-coach-summary-emphasis).
 * 줄바꿈·연속 공백은 공백 하나로 잇는다. 문장 끝은 「. ! ?」 뒤에 공백이 올 때만 본다(「0.75배」의 점은 문장 끝이 아니다).
 * 문장부호가 없으면(LLM 총평은 「…요」로 끝나도 통과한다) 존댓말·평서 어미(「어요·세요·니다·었다」 등) 뒤 공백에서 나눈다.
 * 「필요·중요」처럼 요로 끝나는 낱말은 어미 목록에 없어 나누지 않는다. 그래도 끝이 없으면 전체가 헤드라인이고 나머지는 빈 문자열이다.
 */
const SENTENCE_PUNCT = /^(.+?[.!?])\s+(.+)$/;
const SENTENCE_ENDING = /^(.+?(?:[어아여에예세해래네지게죠까데]요|[니습]다|[었았였겠있없]다))\s+(.+)$/;

export function splitSummary(text: string): { headline: string; rest: string } {
  const flat = text.replace(/\s+/g, ' ').trim();
  // 문장부호 끝과 어미 끝 중 앞선 것을 첫 문장 끝으로 본다(「잘 쳤어요 연습해요. …」에서 첫 마디만 떼어 낸다)
  const byPunct = SENTENCE_PUNCT.exec(flat);
  const byEnding = SENTENCE_ENDING.exec(flat);
  const m = byPunct && byEnding ? (byEnding[1].length < byPunct[1].length ? byEnding : byPunct) : (byPunct ?? byEnding);
  return m ? { headline: m[1], rest: m[2] } : { headline: flat, rest: '' };
}


// ---- 리포트 머리(애플 스타일 개편, 설계 COACH-002-report-apple-redesign 3장) ----

/** 노트 판정 한 줄 막대의 개수. 정확·빠름늦음·놓침은 서버 counts, 빠름·늦음 나누기는 노트가 있을 때만 */
export interface JudgementSplit {
  perfect: number;
  good: number;
  miss: number;
  total: number;
  /** 노트를 받기 전이면 null */
  early: number | null;
  late: number | null;
}

export function judgementSplit(
  counts: Record<'PERFECT' | 'GOOD' | 'MISS', number>,
  notes: readonly Pick<ReportNote, 'judgement' | 'deltaMs'>[] | null,
): JudgementSplit {
  const perfect = Math.max(0, counts.PERFECT || 0);
  const good = Math.max(0, counts.GOOD || 0);
  const miss = Math.max(0, counts.MISS || 0);
  const v = notes ? verdictCounts(notes) : null;
  return { perfect, good, miss, total: perfect + good + miss, early: v ? v.EARLY : null, late: v ? v.LATE : null };
}

/** FE가 짧은 곡에 대신 쓰는 총평의 source. 머리는 이 값이면 「AI가 작성했어요」를 붙이지 않는다 */
export const TEMPLATE_SUMMARY_SOURCE = 'FE_TEMPLATE';
/** 템플릿 총평 레벨 기준. AI config.py의 SUMMARY_* 값과 같게 둔다 */
const SUMMARY_NEEDS_WORK_MISS_RATE = 0.4;
const SUMMARY_GOOD_MISS_RATE = 0.1;
const SUMMARY_GOOD_PERFECT_SHARE = 0.5;

/**
 * 짧은 곡 총평 템플릿. AI weak-rules-0.4까지는 판정 노트가 20개 미만이면 분석·총평이 없었다 — 그때 친 기록과 AI가 총평을 주지 못한
 * 판도 머리가 비지 않게 판정 개수로 고른 문장을 낸다. 분석이 끝났고(DONE) 총평이 없고 노트가 `FULL_ANALYSIS_MIN_NOTES` 미만일 때만 쓰며,
 * 그 밖에는 null(분석 중·실패는 기존 안내 그대로). 0.5부터는 짧은 곡에도 서버 총평이 오므로 새 기록에는 대개 쓰이지 않는다.
 * 문장은 「첫 마디. 설명.」 두 문장 이상이고 점수·정확도 숫자는 쓰지 않는다(AI 규칙 총평과 같은 원칙). 레벨 경계는 AI 규칙 총평과 같다.
 */
export function shortPlaySummary(status: AnalysisStatus, summary: CoachSummary | null, split: JudgementSplit): CoachSummary | null {
  if (summary !== null || status !== 'DONE' || split.total === 0) return null;
  if (split.total >= FULL_ANALYSIS_MIN_NOTES) return null;
  const missRate = split.miss / split.total;
  const perfectShare = split.perfect / split.total;
  const make = (level: string, text: string): CoachSummary => ({ level, text, focusPattern: null, source: TEMPLATE_SUMMARY_SOURCE });
  // 레벨 기준은 AI 규칙 총평(summary.py `_level`)과 같다: 놓침 40% 이상 NEEDS_WORK, 놓침 10% 미만·정확 50% 이상 GOOD
  if (missRate >= SUMMARY_NEEDS_WORK_MISS_RATE) {
    return make('NEEDS_WORK', '짧은 곡이라 아직 손이 덜 풀렸을 수 있어요. 놓친 노트가 몇 개 있었어요. 연습 속도를 낮춰 천천히 익힌 뒤 원래 빠르기로 다시 쳐 보세요.');
  }
  if (missRate < SUMMARY_GOOD_MISS_RATE && perfectShare >= SUMMARY_GOOD_PERFECT_SHARE) {
    return make('GOOD', '짧은 곡을 깔끔하게 마쳤어요. 거의 놓치지 않고 박자를 잘 따라갔어요. 이 감각 그대로 조금 더 긴 곡에도 도전해 보세요.');
  }
  // 그 사이: 빠름·늦음 방향을 알면 그쪽을, 모르거나 놓침이 더 많으면 놓침을 짚는다
  const early = split.early ?? 0;
  const late = split.late ?? 0;
  let tip = '같은 곡을 한 번 더 쳐 보며 감을 굳혀 보세요.';
  if (split.miss > Math.max(early, late)) tip = '놓친 노트가 조금 있었어요. 같은 곡을 한 번 더 쳐 보며 감을 굳혀 보세요.';
  else if (early > late) tip = '몇 노트가 박보다 조금 빨랐어요. 박을 기다렸다 치는 느낌으로 한 번 더 쳐 보세요.';
  else if (late > early) tip = '몇 노트가 박보다 조금 늦었어요. 박에 맞춰 제때 치는 데 집중해 보세요.';
  return make('FAIR', `짧은 곡을 무난하게 마쳤어요. ${tip}`);
}

/** 평균 박자 칸에 쓰는 오차 요약 */
export interface TimingSummary {
  /** 평균 오차(ms). 음수 = 빠름 */
  meanMs: number;
  /** 가운데 절반(25~75%)이 모인 범위(ms) */
  lowMs: number;
  highMs: number;
  samples: number;
}

/** 평균 박자를 보일 최소 표본 수. 이보다 적으면 칸을 숨긴다 */
export const TIMING_MIN_SAMPLES = 5;

/** 정렬된 값의 분위수(선형 보간) */
function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 맞힌 노트(정확·빠름·늦음)의 오차 요약. 표본이 모자라면 null */
export function timingSummary(notes: readonly Pick<ReportNote, 'judgement' | 'deltaMs'>[] | null): TimingSummary | null {
  if (!notes) return null;
  const d = notes
    .filter((n) => n.judgement !== 'MISS' && n.deltaMs !== null && Number.isFinite(n.deltaMs))
    .map((n) => n.deltaMs as number)
    .sort((a, b) => a - b);
  if (d.length < TIMING_MIN_SAMPLES) return null;
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  return { meanMs: mean, lowMs: quantile(d, 0.25), highMs: quantile(d, 0.75), samples: d.length };
}

/** 오차(ms)를 빠름 ← 정박 → 늦음 눈금의 0~1 위치로. 반폭 밖이면 끝에 붙인다 */
export function timingScalePos(deltaMs: number, halfMs: number): number {
  const h = halfMs > 0 ? halfMs : 60;
  return Math.min(1, Math.max(0, 0.5 + deltaMs / (2 * h)));
}

/** 평균 오차 글자: 「12ms 늦게」·「8ms 빠르게」·「정박」 */
export function meanTimingText(meanMs: number): { value: string; unit: string } {
  const abs = Math.round(Math.abs(meanMs));
  if (abs === 0) return { value: '정박', unit: '' };
  return { value: String(abs), unit: `ms ${meanMs < 0 ? '빠르게' : '늦게'}` };
}

/** 지난번 대비 계산에 쓰는 연주 기록 한 줄(서버 연주 기록 목록의 필요한 필드만) */
export interface PlayAccuracyRow {
  playId: string;
  songId: number | null;
  mode: string;
  difficulty: string | null;
  /** 목록 API(GET /api/v1/plays) 그대로 0~100(퍼센트) */
  accuracy: number | null;
  endedAt: string;
}

export interface RecentAccuracy {
  /** 오래된 순 정확도(0~1), 마지막이 이번 연주. 최대 5개 */
  values: number[];
  /** 직전 대비 변화(%p, 반올림) */
  diffPoint: number;
}

export const RECENT_PLAY_COUNT = 5;

/**
 * 같은 곡·같은 모드·같은 연습 단계의 최근 정확도. 이번 연주가 목록에 없거나 정확도 있는 기록이 2번 미만이면 null.
 * 이번 연주보다 나중에 끝난 기록은 넣지 않는다(옛 리포트를 다시 볼 때 그 시점 기준)
 */
export function recentAccuracies(rows: readonly PlayAccuracyRow[], current: { playId: string; songId: number | null; mode: string; difficulty: string | null }): RecentAccuracy | null {
  if (current.songId === null) return null;
  const me = rows.find((r) => r.playId === current.playId);
  if (!me || me.accuracy === null) return null;
  const same = rows
    .filter((r) => r.songId === current.songId && r.mode === current.mode && r.difficulty === current.difficulty && r.accuracy !== null && r.endedAt <= me.endedAt)
    .sort((a, b) => (a.endedAt < b.endedAt ? -1 : a.endedAt > b.endedAt ? 1 : 0))
    .slice(-RECENT_PLAY_COUNT);
  if (same.length < 2 || same[same.length - 1].playId !== current.playId) return null;
  // 목록 API의 정확도는 0~100(퍼센트)이다. 리포트 칸은 0~1로 그리므로 나눈다(곱셈 오차를 없애려 소수 넷째 자리에서 반올림)
  const values = same.map((r) => Math.round((r.accuracy as number) * 100) / 10000);
  // 변화는 화면에 보이는 반올림한 퍼센트끼리 뺀다(93% → 90%면 −3)
  const shown = (v: number) => Math.round(v * 100);
  return { values, diffPoint: shown(values[values.length - 1]) - shown(values[values.length - 2]) };
}
