// 악보 모드 피드백 (MODE-sheet-practice 3-3). PlayLog만 보고 규칙으로 문장을 만든다.
// AI 스코어링이 오면 이 생성기를 AI 응답으로 교체한다. 임계값은 팀 체감 후 조정(U3).
import { COACH_BASIS, type CoachBasis, coachBasisMs } from '@/domain/play/coachBasis';
import type { Chart } from '@/domain/song/chart';
import { JUDGEMENT_SCORE } from '@/domain/play/judgement';
import { ALL_PADS, PAD_META, type PadId } from '@/domain/kit/pads';
import { gridOriginMs, gridTimeOf, type GridChart } from '@/domain/song/sheet';
import type { PlayLog } from '@/domain/play/playLog';

/** 1. 패드의 MISS 비율 하한과 그 판단에 필요한 최소 노트 수 */
export const MISS_RATE_THRESHOLD = 0.25;
export const MISS_RATE_MIN_NOTES = 4;
/** 2. 전체 Δ 평균 절대값 하한(ms) */
export const MEAN_DELTA_THRESHOLD_MS = 15;
/** 3. 구간(마디 단위) 정확도가 전체 평균보다 낮아야 하는 폭(0~1)과 구간 크기, 구간 최소 노트 수 */
export const SEGMENT_ACCURACY_GAP = 0.15;
export const SEGMENT_BARS = 4;
export const SEGMENT_MIN_NOTES = 4;
/**
 * 4. 패드 Δ 표준편차 하한 비율(× 코칭 기준 폭 coachBasisMs, 판정 폭과 분리: 판정=난이도·코칭=실제 박 오차, MODE-001 D2)과 최소 표본 수.
 * 오차가 판정 폭(±goodMs) 안에 갇혀 고르게 흩어져도 표준편차가 약 0.58×goodMs라 35ms 고정은 거의 걸리지 않는다(AI 쪽과 같은 수정).
 */
export const PAD_STD_GOOD_RATIO = 0.5;
export const PAD_STD_MIN_SAMPLES = 4;
/** 5. 채보 밖 타격 비율 하한 (노트 수 대비) */
export const STRAY_RATE_THRESHOLD = 0.1;
/** 카드 최대 개수 */
export const MAX_FEEDBACK_ITEMS = 3;

export interface FeedbackItem {
  id: string;
  title: string;
  body: string;
  suggestion: string;
  pads?: PadId[];
  /** 마디 범위 [from, to], 0부터, 양쪽 포함. 화면에는 +1해서 보여준다 */
  bars?: [number, number];
}

export interface PadSummary {
  pad: PadId;
  total: number;
  perfect: number;
  good: number;
  miss: number;
  /** 타격이 있었던 노트의 Δ 평균(ms). 없으면 null */
  meanDeltaMs: number | null;
  /** 패드 정확도(0~1). 판정된 노트의 점수 평균 — `accuracyOf`와 같은 기준 */
  accuracy: number;
  /** 평균 타격 세기(0~100). 판정된 노트에 매칭된 타격 velocity(1~127) 평균. 로그에 hits가 없으면 null */
  meanVelocity: number | null;
}

type LogNote = PlayLog['notes'][number];

const isMiss = (n: LogNote) => n.judgement === null || n.judgement === 'MISS';

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function std(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function hasBatchim(word: string): boolean {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
}

/** 을/를 */
function eulReul(word: string): string {
  return hasBatchim(word) ? '을' : '를';
}

function barRange(bars: number[]): [number, number] | undefined {
  return bars.length ? [Math.min(...bars), Math.max(...bars)] : undefined;
}

function fmtBars(r: [number, number]): string {
  return r[0] === r[1] ? `${r[0] + 1}마디` : `${r[0] + 1}~${r[1] + 1}마디`;
}

function accuracyOf(notes: LogNote[]): number {
  if (!notes.length) return 0;
  const sum = notes.reduce((s, n) => s + (n.judgement ? JUDGEMENT_SCORE[n.judgement] : 0), 0);
  return sum / (notes.length * JUDGEMENT_SCORE.PERFECT);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : '-'}${Math.abs(x).toFixed(0)}`;

export function summarizeByPad(log: PlayLog): PadSummary[] {
  return ALL_PADS.flatMap((pad) => {
    // 분모는 판정된 노트만(BE 리포트 padStats와 같은 기준). 중도 중단으로 판정 전인 노트는 뺀다
    const notes = log.notes.filter((n) => n.pad === pad && n.judgement !== null);
    if (!notes.length) return [];
    const deltas = notes.flatMap((n) => (n.deltaMs === null ? [] : [n.deltaMs]));
    // 판정된 이 패드 노트에 매칭된 타격의 세기. matchedNoteIndex는 log.notes의 배열 위치(playUpload와 같은 해석)
    const velocities = (log.hits ?? []).flatMap((h) => {
      const note = h.judgement && h.matchedNoteIndex !== undefined ? log.notes[h.matchedNoteIndex] : undefined;
      return note && note.pad === pad && note.judgement !== null ? [h.velocity] : [];
    });
    return [
      {
        pad,
        total: notes.length,
        perfect: notes.filter((n) => n.judgement === 'PERFECT').length,
        good: notes.filter((n) => n.judgement === 'GOOD').length,
        miss: notes.filter((n) => n.judgement === 'MISS').length,
        meanDeltaMs: deltas.length ? mean(deltas) : null,
        accuracy: accuracyOf(notes),
        meanVelocity: velocities.length ? Math.round((mean(velocities) / 127) * 100) : null,
      },
    ];
  });
}

export function buildFeedback(
  log: PlayLog,
  chart?: Pick<Chart, 'bpm' | 'beatsPerBar'> & Partial<Pick<Chart, 'offsetMs'>>,
  basis: CoachBasis = COACH_BASIS,
): FeedbackItem[] {
  const notes = log.notes;
  const barMs = chart ? (60_000 / chart.bpm) * chart.beatsPerBar : 0;
  // 마디는 격자 원점(offsetMs)을 뺀 격자 시각으로 센다 — 악보 화면의 마디 번호와 같아야 한다
  const originMs = chart ? gridOriginMs(chart) : 0;
  const barOf = (n: LogNote) => (barMs ? Math.max(0, Math.floor((gridTimeOf(n.timeMs, originMs) + 1) / barMs)) : -1);
  const items: FeedbackItem[] = [];

  if (!notes.length) return [fallback(log)];

  // 1. 패드별 MISS 비율 (가장 높은 패드 하나)
  const worst = summarizeByPad(log)
    .filter((s) => s.total >= MISS_RATE_MIN_NOTES && s.miss / s.total >= MISS_RATE_THRESHOLD)
    .sort((a, b) => b.miss / b.total - a.miss / a.total)[0];
  if (worst) {
    const label = PAD_META[worst.pad].label;
    const missBars = barRange(
      notes
        .filter((n) => n.pad === worst.pad && isMiss(n))
        .map(barOf)
        .filter((b) => b >= 0),
    );
    items.push({
      id: 'pad-miss',
      title: `${label}${eulReul(label)} 자주 놓쳐요`,
      body: `${label} 노트 ${worst.total}개 중 ${worst.miss}개(${pct(worst.miss / worst.total)})를 놓쳤어요.`,
      suggestion: missBars
        ? `${fmtBars(missBars)} 악보에서 ${label} 자리를 눈으로 먼저 따라간 뒤 다시 쳐 보세요.`
        : `악보에서 ${label} 자리를 눈으로 먼저 따라간 뒤 다시 쳐 보세요.`,
      pads: [worst.pad],
      bars: missBars,
    });
  }

  // 2. 전체 Δ 평균
  const deltas = notes.flatMap((n) => (n.deltaMs === null ? [] : [n.deltaMs]));
  if (deltas.length) {
    const m = mean(deltas);
    if (Math.abs(m) >= MEAN_DELTA_THRESHOLD_MS) {
      items.push({
        id: 'mean-delta',
        title: `전체적으로 ${m > 0 ? '늦어요' : '빨라요'}`,
        body: `타격이 채보보다 평균 ${signed(m)}ms ${m > 0 ? '늦게' : '빠르게'} 들어갔어요.`,
        suggestion: '메트로놈을 켜고 카운트인을 2마디로 늘려 박을 몸에 익혀 보세요.',
      });
    }
  }

  // 3. 4마디 구간 정확도 (전체 평균보다 가장 많이 낮은 구간 하나)
  if (barMs) {
    const overall = accuracyOf(notes);
    const segments = new Map<number, LogNote[]>();
    for (const n of notes) {
      const seg = Math.floor(barOf(n) / SEGMENT_BARS);
      segments.set(seg, [...(segments.get(seg) ?? []), n]);
    }
    let weak: { seg: number; acc: number } | null = null;
    for (const [seg, list] of segments) {
      if (list.length < SEGMENT_MIN_NOTES) continue;
      const acc = accuracyOf(list);
      if (overall - acc >= SEGMENT_ACCURACY_GAP && (!weak || acc < weak.acc)) weak = { seg, acc };
    }
    if (weak) {
      const last = Math.max(...notes.map(barOf));
      const bars: [number, number] = [
        weak.seg * SEGMENT_BARS,
        Math.min(weak.seg * SEGMENT_BARS + SEGMENT_BARS - 1, last),
      ];
      items.push({
        id: 'segment',
        title: `${fmtBars(bars)}에서 흔들려요`,
        body: `이 구간 정확도 ${pct(weak.acc)}로 전체 ${pct(overall)}보다 낮아요.`,
        suggestion: `${fmtBars(bars)} 악보를 눈으로 먼저 따라간 뒤 다시 쳐 보세요.`,
        bars,
      });
    }
  }

  // 4. 패드별 Δ 표준편차 (가장 큰 패드 하나)
  const padStdThresholdMs = PAD_STD_GOOD_RATIO * coachBasisMs(basis, log.timing.goodMs);
  let jittery: { pad: PadId; sd: number } | null = null;
  for (const pad of ALL_PADS) {
    const ds = notes.flatMap((n) => (n.pad === pad && n.deltaMs !== null ? [n.deltaMs] : []));
    if (ds.length < PAD_STD_MIN_SAMPLES) continue;
    const sd = std(ds);
    if (sd >= padStdThresholdMs && (!jittery || sd > jittery.sd)) jittery = { pad, sd };
  }
  if (jittery) {
    const label = PAD_META[jittery.pad].label;
    items.push({
      id: 'pad-jitter',
      title: `${label} 타이밍이 들쭉날쭉해요`,
      body: `${label} 타격 시각의 편차가 ${jittery.sd.toFixed(0)}ms예요.`,
      suggestion: `자유 연습에서 메트로놈을 켜고 ${label}만 일정한 간격으로 쳐 보세요.`,
      pads: [jittery.pad],
    });
  }

  // 5. 채보 밖 타격
  const stray = log.summary.strayHits;
  if (stray >= notes.length * STRAY_RATE_THRESHOLD) {
    items.push({
      id: 'stray',
      title: '채보에 없는 타격이 많아요',
      body: `채보에 없는 타격이 ${stray}번 있었어요(노트 ${notes.length}개 기준).`,
      suggestion: '악보를 보면서 칠 칸을 먼저 눈으로 따라가 보세요.',
    });
  }

  return items.length ? items.slice(0, MAX_FEEDBACK_ITEMS) : [fallback(log)];
}

function fallback(log: PlayLog): FeedbackItem {
  const total = log.summary.counts.PERFECT + log.summary.counts.GOOD + log.summary.counts.MISS;
  const perfectRate = total ? log.summary.counts.PERFECT / total : 0;
  return {
    id: 'stable',
    title: '안정적이에요',
    body: `정확도 ${pct(log.summary.accuracy)}, PERFECT 비율 ${pct(perfectRate)}로 눈에 띄는 약점이 없어요.`,
    suggestion: '다음 곡에 도전하거나 같은 곡을 더 높은 연습 단계로 쳐 보세요.',
  };
}

/** 결과 페이지 미니 악보용: 로그의 노트·BPM·박자·격자 원점만으로 `layoutBar`가 읽는 채보 모양을 만든다. 이전 로그(bpm 없음)는 null */
export function chartFromLog(log: PlayLog): GridChart | null {
  if (!log.bpm) return null;
  return {
    bpm: log.bpm,
    beatsPerBar: log.beatsPerBar,
    offsetMs: log.offsetMs ?? 0,
    notes: log.notes.map((n) => ({ pad: n.pad, timeMs: n.timeMs, ...(n.pad === 'HIHAT' && n.hihatOpen === true ? { hihatOpen: true as const } : {}) })),
  };
}

/** 열린 하이햇의 전체 채보 수와 유일한 성공 노트 수. 측정 불완전은 숫자를 표시하지 않는다. */
export function summarizeOpenHihat(log: PlayLog): { text: string; label: string } | null {
  if (log.mode !== 'SHEET' || !log.hihatPedalCoverage || log.hihatPedalCoverage === 'NONE') return null;
  const open = new Set(log.notes.filter((n) => n.pad === 'HIHAT' && n.hihatOpen === true).map((n) => n.index));
  if (!open.size) return null;
  const incompleteRun = log.lastSongTimeMs !== undefined && log.lastSongTimeMs < log.durationMs;
  const suffix = incompleteRun ? ' · 전체 채보 기준' : '';
  if (log.hihatPedalCoverage === 'PARTIAL') {
    const text = `열린 하이햇 · 측정 불완전${suffix}`;
    return { text, label: text };
  }
  const hits = new Set<number>();
  for (const h of log.hits) {
    if (h.matchedNoteIndex !== undefined && open.has(h.matchedNoteIndex) && (h.judgement === 'PERFECT' || h.judgement === 'GOOD') && h.hihatClosed === false) hits.add(h.matchedNoteIndex);
  }
  return { text: `열린 ${hits.size}/${open.size}${suffix}`, label: `열린 하이햇: 페달을 떼고 정확히 친 노트 ${hits.size}개, 전체 열린 노트 ${open.size}개${suffix}` };
}
