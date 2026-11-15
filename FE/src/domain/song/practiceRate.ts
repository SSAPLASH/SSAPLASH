// 악보 연습 속도 조절(설계 MODE-003-practice-speed). 배율 값·검사, 채보 늘리기, 곡 시각 되돌리기, 표시 문구. 순수 함수.
// 느리게 치는 방법은 「채보를 늘리는 것」 하나다: 세션을 만들기 전에 시각을 배율로 나누고 BPM에 배율을 곱한다.
// 엔진·곡 시계·악보·메트로놈은 늘린 채보를 그대로 보므로 고칠 것이 없다. 기록은 원래 채보의 축(곡 시각)으로 되돌려 남긴다.
import type { Chart } from './chart';

/** 연습 속도 범위와 한 단계(배율). 50~100 %를 5 % 단위로 */
export const RATE_MIN = 0.5;
export const RATE_MAX = 1;
export const RATE_STEP = 0.05;

/** 배율을 퍼센트 정수로(0.7 → 70). 계산은 정수 퍼센트로 하고 ÷ 100으로 되돌려 소수 오차가 쌓이지 않게 한다 */
export function ratePercent(rate: number): number {
  return Math.round(rate * 100);
}

/** 범위 안의 5 % 단위 값인지 */
export function isPracticeRate(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const pct = v * 100;
  return v >= RATE_MIN && v <= RATE_MAX && Math.abs(pct - Math.round(pct)) < 1e-9 && Math.round(pct) % 5 === 0;
}

/** 이상한 값은 1(원래 빠르기)로 */
export function sanitizeRate(v: unknown): number {
  return isPracticeRate(v) ? ratePercent(v) / 100 : 1;
}

/** 한 단계 느리게(-1)·빠르게(+1). 범위 밖으로 나가지 않는다 */
export function stepRate(rate: number, dir: -1 | 1): number {
  const pct = ratePercent(sanitizeRate(rate)) + dir * ratePercent(RATE_STEP);
  return Math.min(ratePercent(RATE_MAX), Math.max(ratePercent(RATE_MIN), pct)) / 100;
}

/**
 * 배율만큼 느리게 칠 채보. 노트 시각·길이·원점·빠르기 구간 시각을 배율로 나누고 BPM(구간 BPM 포함)에 배율을 곱한다.
 * 노트 수·순서·패드·noteId·박자는 그대로다. 원래 값은 노트 `sourceTimeMs`와 채보 `sourceTiming`에 남긴다.
 * 배율이 1이면 받은 채보를 그대로 돌려준다
 */
export function scaleChart(chart: Chart, rate: number): Chart {
  const r = sanitizeRate(rate);
  if (r === 1) return chart;
  return {
    ...chart,
    bpm: chart.bpm * r,
    offsetMs: chart.offsetMs / r,
    durationMs: chart.durationMs / r,
    notes: chart.notes.map((n) => ({ ...n, timeMs: n.timeMs / r, sourceTimeMs: n.timeMs })),
    ...(chart.tempoSegments ? { tempoSegments: chart.tempoSegments.map((s) => ({ beat: s.beat, startMs: s.startMs / r, bpm: s.bpm * r })) } : {}),
    playbackRate: r,
    sourceTiming: { durationMs: chart.durationMs, bpm: chart.bpm, offsetMs: chart.offsetMs },
  };
}

/** 연주 시각(늘린 축, ms) → 곡 시각(원래 채보 축). 배율 1이면 그대로 */
export function toSongMs(ms: number, rate: number): number {
  return rate === 1 ? ms : ms * rate;
}

/**
 * 서버·로그의 배율 값에서 「느리게 친 판」의 배율만 꺼낸다. 0 초과 1 미만의 숫자면 그 값, 그 밖(없음·1·이상한 값)은 null.
 * 5 % 단위인지는 따지지 않는다(서버가 저장한 값을 그대로 보인다)
 */
export function slowRateOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1 ? v : null;
}

/** 「70%」 */
export function rateLabel(rate: number): string {
  return `${ratePercent(rate)}%`;
}

/** 실제 빠르기 풀이: 「BPM 120 → 84」, 100 %면 「원래 빠르기」. BPM은 정수로 반올림해 적는다 */
export function rateHint(bpm: number, rate: number): string {
  if (ratePercent(rate) === 100) return '원래 빠르기';
  return `BPM ${Math.round(bpm)} → ${Math.round(bpm * rate)}`;
}
