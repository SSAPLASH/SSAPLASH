// 녹화 타이밍 분석 보고서(순수 함수, 설계 3-1). 진단 이벤트 목록을 세션별로 나눠 delta 평균·곡 시각 대비 기울기·
// 구간 평균·입력 출처별 통계와 판별 힌트(설계 4-2)를 낸다. 파일 읽기·화면은 맡지 않는다.
import type { ResolvedHit } from '@/domain/events';
import type { DiagEvent } from '@/engine/diagTap';
import { median, slopeMsPerMin } from './syncTrend';

/** 판정 수가 이보다 적으면 "표본 부족"(설계 3-1 규칙) */
export const MIN_JUDGED = 20;
/** 오차 작음 기준: 평균 절댓값(ms) 미만 (설계 4-2 마지막 줄) */
export const SMALL_MEAN_MS = 10;
/** 기울기 있음 기준: 기울기 절댓값(ms/분) 이상 (설계 4-2 마지막 줄). accDrift 기울기에도 같이 쓴다 */
export const SMALL_SLOPE_MS_PER_MIN = 1;

export interface InputStat {
  /** 입력 출처 이름('keyboard', '<센서> 왼손' 등) */
  input: string;
  n: number;
  meanMs: number | null;
  slopeMsPerMin: number | null;
}

export interface AccDriftStat {
  n: number;
  startMs: number;
  endMs: number;
  /** (세션 곡 시각, driftMs) 최소제곱 기울기(ms/분). 표본이 2개 미만이면 null */
  slopeMsPerMin: number | null;
}

export interface SessionTiming {
  songId: string;
  title: string;
  chartVersionId: number | null;
  mode: 'RHYTHM' | 'SHEET';
  /** 세션 시작 시각(녹화 기준 ms, 진단 이벤트 t) */
  startedAt: number;
  /** 입력 출처별 판정 건수(채보 밖 타격 제외) */
  inputs: Record<string, number>;
  /** delta가 있는 판정 수 */
  judged: number;
  /** MISS 수(타격이 붙은 MISS + 시간 초과 missed) */
  miss: number;
  /** |delta| > GOOD 폭이라 통계에서 뺀 수 */
  outliers: number;
  /** 판정 수가 MIN_JUDGED 미만 */
  lowSample: boolean;
  meanMs: number | null;
  medianMs: number | null;
  stdMs: number | null;
  slopeMsPerMin: number | null;
  /** 곡 앞·중·뒤 1/3 구간별 delta 평균. 구간은 세션 표본의 곡 시각 범위를 3등분 */
  thirds: [number | null, number | null, number | null];
  byInput: InputStat[];
  accDrift: AccDriftStat | null;
  verdictHint: string;
}

interface Sample {
  songTimeMs: number;
  deltaMs: number;
  input: string;
}

interface Acc {
  head: Extract<DiagEvent, { type: 'session' }>;
  startedAt: number;
  samples: Sample[];
  inputs: Record<string, number>;
  miss: number;
  outliers: number;
  judged: number;
  drift: { songTimeMs: number; driftMs: number }[];
}

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);

const slopeOf = (pts: readonly { t: number; v: number }[]): number | null =>
  slopeMsPerMin(pts.map((p) => ({ t: p.t, offsetObsMs: p.v })));

const NON_SENSOR = ['keyboard', 'preview', 'touch', '알 수 없음'];

/** 타격의 입력 출처 이름. 센서는 손·발까지 나눈다 */
function inputLabel(hit: ResolvedHit | undefined): string {
  if (!hit) return '알 수 없음';
  if (NON_SENSOR.includes(hit.source)) return hit.source;
  const part = hit.foot === 2 ? '왼발' : hit.foot === 3 ? '오른발' : hit.stickId === 0 ? '왼손' : hit.stickId === 1 ? '오른손' : '';
  return part ? `${hit.source} ${part}` : hit.source;
}

/**
 * 설계 4-2 판별표를 단순화한 한 줄 힌트. E0(귀)·세션 간 추이(E2)·장치 비교(E4)는 한 세션만으론 알 수 없으므로
 * 평균·기울기·accDrift로 낼 수 있는 결론만 적는다.
 */
function verdict(mean: number | null, slope: number | null, acc: AccDriftStat | null, hasSensor: boolean): string {
  if (mean === null) return '통계 없음';
  const slopeBig = slope !== null && Math.abs(slope) >= SMALL_SLOPE_MS_PER_MIN;
  const meanBig = Math.abs(mean) >= SMALL_MEAN_MS;
  // 마지막 줄: 평균 10ms 미만, 기울기 1ms/분 미만
  if (!slopeBig && !meanBig) return '오차 작음 → 사람 체감 문제 또는 해결됨(QA 재확인)';
  const accSlope = acc?.slopeMsPerMin ?? null;
  const accKnown = accSlope !== null;
  const accBig = accSlope !== null && Math.abs(accSlope) >= SMALL_SLOPE_MS_PER_MIN;
  let text: string;
  if (slopeBig) {
    // 둘째·셋째 줄: 곡 안에서 점점 커짐. accDrift로 채보(D)와 반주 시계(B)를 가른다
    if (!accKnown) text = '곡 안 기울기 있음, accDrift 없음 → 채보 BPM과 반주 시계 구분 불가(T2 녹화 필요)';
    else if (accBig) text = '곡 안 기울기 있음, 반주 드리프트도 있음 → 반주 시계(B) 의심';
    else text = '곡 안 기울기 있음, 반주 드리프트 작음 → 채보 BPM 의심(D)';
  } else if (accBig) {
    text = '일정 오프셋이지만 반주 드리프트 있음 → 반주 시계(B) 확인';
  } else {
    // 첫째·다섯째 줄: 일정 오프셋은 곡·입력·장치 비교로 채보 원점(D)과 출력 지연(C)을 가른다
    text = `일정하게 늦거나 빠름${accKnown ? ', 반주 드리프트 작음' : ', accDrift 없음'} → 채보 원점(D) 또는 출력 지연(C) 의심, 곡·입력·장치 비교 필요`;
  }
  // 넷째 줄: 스틱 시계(A)는 세션 간 이동으로만 보인다
  if (hasSensor) text += ' · 스틱: 세션이 지날수록 이동하면 스틱 시계(A)';
  return text;
}

function finish(a: Acc): SessionTiming {
  const xs = a.samples.map((s) => s.deltaMs);
  const m = mean(xs);
  const std = m === null ? null : Math.sqrt(xs.reduce((acc, v) => acc + (v - m) ** 2, 0) / xs.length);
  const slope = slopeOf(a.samples.map((s) => ({ t: s.songTimeMs, v: s.deltaMs })));

  const ts = a.samples.map((s) => s.songTimeMs);
  const lo = ts.length ? Math.min(...ts) : 0;
  const span = ts.length ? Math.max(...ts) - lo : 0;
  const parts: number[][] = [[], [], []];
  for (const s of a.samples) {
    const idx = span === 0 ? 0 : Math.min(2, Math.floor(((s.songTimeMs - lo) / span) * 3));
    parts[idx].push(s.deltaMs);
  }

  const names = [...new Set(a.samples.map((s) => s.input))].sort();
  const byInput: InputStat[] = names.map((input) => {
    const own = a.samples.filter((s) => s.input === input);
    return {
      input,
      n: own.length,
      meanMs: mean(own.map((s) => s.deltaMs)),
      slopeMsPerMin: slopeOf(own.map((s) => ({ t: s.songTimeMs, v: s.deltaMs }))),
    };
  });

  let accDrift: AccDriftStat | null = null;
  if (a.drift.length > 0) {
    accDrift = {
      n: a.drift.length,
      startMs: a.drift[0].driftMs,
      endMs: a.drift[a.drift.length - 1].driftMs,
      slopeMsPerMin: slopeOf(a.drift.map((d) => ({ t: d.songTimeMs, v: d.driftMs }))),
    };
  }

  const lowSample = a.judged < MIN_JUDGED;
  const hasSensor = names.some((n) => !NON_SENSOR.includes(n));
  return {
    songId: a.head.songId,
    title: a.head.title,
    chartVersionId: a.head.chartVersionId,
    mode: a.head.mode,
    startedAt: a.startedAt,
    inputs: a.inputs,
    judged: a.judged,
    miss: a.miss,
    outliers: a.outliers,
    lowSample,
    meanMs: m,
    medianMs: median(xs),
    stdMs: std,
    slopeMsPerMin: slope,
    thirds: [mean(parts[0]), mean(parts[1]), mean(parts[2])],
    byInput,
    accDrift,
    verdictHint: lowSample ? '표본 부족' : verdict(m, slope, accDrift, hasSensor),
  };
}

/** 진단 이벤트 목록 → 세션별 타이밍 보고서. 세션 경계는 session start·end 이벤트, 시작 전 이벤트는 버린다 */
export function timingReport(diags: readonly DiagEvent[]): SessionTiming[] {
  const out: SessionTiming[] = [];
  const hits = new Map<number, ResolvedHit>();
  let cur: Acc | null = null;
  const close = (): void => {
    if (cur) out.push(finish(cur));
    cur = null;
  };

  for (const ev of diags) {
    if (ev.type === 'resolved') {
      hits.set(ev.hit.id, ev.hit);
    } else if (ev.type === 'session') {
      if (ev.phase === 'start') {
        close();
        cur = { head: ev, startedAt: ev.t, samples: [], inputs: {}, miss: 0, outliers: 0, judged: 0, drift: [] };
      } else if (ev.phase === 'end') {
        close();
      }
    } else if (cur && ev.type === 'judged') {
      // 채보 밖 타격(judgement null)은 통계에서 뺀다
      if (ev.judgement === null) continue;
      const input = inputLabel(hits.get(ev.hitId));
      cur.inputs[input] = (cur.inputs[input] ?? 0) + 1;
      if (ev.judgement === 'MISS') cur.miss++;
      if (ev.deltaMs === null) continue;
      cur.judged++;
      // 판정 창 밖으로 튄 값은 건수만 센다
      if (Math.abs(ev.deltaMs) > cur.head.windows.goodMs) {
        cur.outliers++;
        continue;
      }
      cur.samples.push({ songTimeMs: ev.songTimeMs, deltaMs: ev.deltaMs, input });
    } else if (cur && ev.type === 'missed') {
      // 연결된 타격 없이 시간 초과로 MISS가 된 노트도 MISS 수에 넣는다
      cur.miss++;
    } else if (cur && ev.type === 'accDrift') {
      cur.drift.push({ songTimeMs: ev.songTimeMs, driftMs: ev.driftMs });
    }
  }
  close();
  return out;
}
