// 박자 맞추기(판정 타이밍 자동 보정) 계산. 순수 함수 (설계 PLAY-004-timing-offset-calibration 3장).
// 메트로놈 박에 맞춰 친 타격이 박보다 얼마나 이르거나 늦는지의 중앙값을 내어 audioOffsetMs에 넣을 값을 만든다.
// 아래 상수는 시작값이다. EMB와 실측한 뒤 여기만 고치면 화면·저장 범위·테스트가 따라온다.

/** 측정 클릭 빠르기(BPM). 박 간격 600ms */
export const TIMING_CAL_BPM = 100;
/** 듣기만 하는 앞쪽 박 수. 이 박들은 짝짓지 않는다 */
export const TIMING_CAL_LISTEN_BEATS = 4;
/** 재는 박 수 */
export const TIMING_CAL_MEASURE_BEATS = 12;
/** 스틱 구간과 킥 구간 사이의 전환 박 수. 이 박들은 짝짓지 않는다 */
export const TIMING_CAL_SWITCH_BEATS = 4;
/** 킥 구간에서 재는 박 수 */
export const TIMING_CAL_KICK_BEATS = 12;
/** 스틱·킥 중앙값이 이보다 많이 다르면 다시 재 보라고 권한다(ms) */
export const TIMING_CAL_RECHECK_DIFF_MS = 60;
/** 박과 타격을 짝짓는 폭(±ms). 박 간격의 절반보다 좁아 한 타격이 두 박에 걸리지 않는다 */
export const TIMING_CAL_PAIR_WINDOW_MS = 250;
/** 이보다 짝이 적으면 표본 부족 (실측 뒤 조정) */
export const TIMING_CAL_MIN_PAIRS = 8;
/** 흩어짐(중앙값 절대편차) 한도(ms). 넘으면 다시 하게 한다 (실측 뒤 조정) */
export const TIMING_CAL_MAX_MAD_MS = 25;
/** 판정 타이밍 보정값의 단위(ms). 자동 값도 이 단위로 반올림한다 */
export const TIMING_OFFSET_STEP_MS = 5;
/** 판정 타이밍 보정값 범위(ms). 자동 값·수동 칸·저장값이 같이 쓴다 (실측 뒤 조정) */
export const TIMING_OFFSET_MIN_MS = -250;
export const TIMING_OFFSET_MAX_MS = 100;
/** 브라우저가 보고한 출력 지연이 이 값을 넘으면 유선 출력을 권한다 (실측 뒤 조정) */
export const OUTPUT_LATENCY_WARN_MS = 100;

/** 측정에 쓴 입력. 스틱·페달은 sensor, 키보드·화면 터치는 keyboard */
export type TimingCalInput = 'sensor' | 'keyboard';

/** 타격한 부위. stick 스틱 / kick 킥 페달 */
export type TimingCalLimb = 'stick' | 'kick';

export interface TimingCalTap {
  /** 타격 시각(performance.now 기준). 판정이 쓰는 tHit */
  tHit: number;
  input: TimingCalInput;
  limb: TimingCalLimb;
}

/** ok 성공 / few 짝이 모자람 / scattered 흩어짐이 큼 */
export type TimingCalStatus = 'ok' | 'few' | 'scattered';

export interface TimingCalResult {
  status: TimingCalStatus;
  /** 박과 짝지어진 타격 수 */
  pairs: number;
  /** (타격 − 박)의 중앙값(ms). 음수 = 박보다 이르게 침. 짝이 없으면 null */
  medianMs: number | null;
  /** 중앙값 절대편차(ms). 짝이 없으면 null */
  madMs: number | null;
  /** audioOffsetMs에 넣을 값(반올림·범위 적용). 성공일 때만 */
  offsetMs: number | null;
  /** 짝지어진 타격의 다수 입력. 짝이 없으면 null */
  input: TimingCalInput | null;
}

/** 설정에 남기는 마지막 측정 기록 */
export interface TimingCalRecord {
  /** 측정 시각(epoch ms) */
  measuredAt: number;
  medianMs: number;
  madMs: number;
  pairs: number;
  input: TimingCalInput;
  /** 측정 때 브라우저가 보고한 출력 지연(ms). 모르면 null */
  outputLatencyMs: number | null;
  /** 킥 구간 측정 결과. 킥을 재지 않았거나 실패했으면 null */
  kick: { medianMs: number; madMs: number; pairs: number } | null;
}

/** 저장된 측정 기록을 검사한다. 모양이 맞지 않으면 null */
export function sanitizeTimingCalRecord(raw: unknown): TimingCalRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!num(r.measuredAt) || !num(r.medianMs) || !num(r.madMs) || !num(r.pairs)) return null;
  if (r.input !== 'sensor' && r.input !== 'keyboard') return null;
  // 옛 저장분(kick 없음)이나 모양이 틀린 kick은 null로 읽는다. 기록 전체를 버리지 않는다
  const k = r.kick as Record<string, unknown> | null | undefined;
  const kick = typeof k === 'object' && k !== null && num(k.medianMs) && num(k.madMs) && num(k.pairs)
    ? { medianMs: k.medianMs, madMs: k.madMs, pairs: k.pairs }
    : null;
  return {
    measuredAt: r.measuredAt,
    medianMs: r.medianMs,
    madMs: r.madMs,
    pairs: r.pairs,
    input: r.input,
    outputLatencyMs: num(r.outputLatencyMs) ? r.outputLatencyMs : null,
    kick,
  };
}

/**
 * 발 타격(하이햇 페달·킥)에 쓸 판정 타이밍 보정값. 킥 값을 따로 재지 않았으면(null) 스틱 값을 쓴다
 * (설계 PLAY-004-timing-cal-stick-kick D1·D2)
 */
export function kickOffsetOrStick(audioOffsetMs: number, kickOffsetMs: number | null): number {
  return kickOffsetMs ?? audioOffsetMs;
}

/** 박 간격(ms) */
export function timingCalBeatMs(): number {
  return 60_000 / TIMING_CAL_BPM;
}

/** 보정값을 단위로 반올림하고 범위로 자른다. 숫자가 아니면 0 */
export function clampTimingOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  const stepped = Math.round(ms / TIMING_OFFSET_STEP_MS) * TIMING_OFFSET_STEP_MS;
  // -0을 0으로
  return Math.min(TIMING_OFFSET_MAX_MS, Math.max(TIMING_OFFSET_MIN_MS, stepped)) + 0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 측정 박마다 폭 안에서 가장 가까운 타격 하나를 짝짓는다. 반환은 짝지어진 타격과 그 어긋남(타격 − 박).
 * 폭이 박 간격 절반보다 좁으므로 한 타격이 두 박에 쓰이지 않는다.
 */
export function pairTaps(beats: number[], taps: TimingCalTap[]): { tap: TimingCalTap; deltaMs: number }[] {
  const out: { tap: TimingCalTap; deltaMs: number }[] = [];
  for (const beat of beats) {
    let best: TimingCalTap | null = null;
    let bestAbs = Infinity;
    for (const tap of taps) {
      const abs = Math.abs(tap.tHit - beat);
      if (abs <= TIMING_CAL_PAIR_WINDOW_MS && abs < bestAbs) {
        best = tap;
        bestAbs = abs;
      }
    }
    if (best) out.push({ tap: best, deltaMs: best.tHit - beat });
  }
  return out;
}

/** beats는 측정 박(듣기 박 제외)의 실제 울린 시각, taps는 측정 동안 받은 타격 전부 */
export function evaluateTimingCal(beats: number[], taps: TimingCalTap[]): TimingCalResult {
  const paired = pairTaps(beats, taps);
  const pairs = paired.length;
  if (pairs === 0) return { status: 'few', pairs, medianMs: null, madMs: null, offsetMs: null, input: null };
  const deltas = paired.map((p) => p.deltaMs);
  const medianMs = median(deltas);
  const madMs = median(deltas.map((d) => Math.abs(d - medianMs)));
  const sensor = paired.filter((p) => p.tap.input === 'sensor').length;
  const input: TimingCalInput = sensor * 2 >= pairs ? 'sensor' : 'keyboard';
  const status: TimingCalStatus = pairs < TIMING_CAL_MIN_PAIRS ? 'few' : madMs > TIMING_CAL_MAX_MAD_MS ? 'scattered' : 'ok';
  return { status, pairs, medianMs, madMs, offsetMs: status === 'ok' ? clampTimingOffset(medianMs) : null, input };
}

/** 스틱 구간·킥 구간 결과와 다시 재 보라는 권유 */
export interface TimingCalOutcome {
  stick: TimingCalResult;
  /** 킥 구간이 없었으면 null */
  kick: TimingCalResult | null;
  /** 스틱·킥 둘 다 성공했는데 중앙값이 많이 다르면 true. 적용은 막지 않는다 */
  recheck: boolean;
}

/** 구간별로 그 구간 입력(스틱/킥)의 타격만 평가한다. kickBeats가 null이면 킥 구간이 없었던 것 */
export function evaluateTimingCalPhases(stickBeats: number[], kickBeats: number[] | null, taps: TimingCalTap[]): TimingCalOutcome {
  const stick = evaluateTimingCal(stickBeats, taps.filter((t) => t.limb === 'stick'));
  const kick = kickBeats ? evaluateTimingCal(kickBeats, taps.filter((t) => t.limb === 'kick')) : null;
  const recheck =
    kick !== null &&
    stick.status === 'ok' &&
    kick.status === 'ok' &&
    stick.medianMs !== null &&
    kick.medianMs !== null &&
    Math.abs(stick.medianMs - kick.medianMs) > TIMING_CAL_RECHECK_DIFF_MS;
  return { stick, kick, recheck };
}

/** 설정에 넣을 값. 스틱이 실패하면 null. 킥이 없었거나 실패하면 kickOffsetMs는 null(스틱 값을 쓴다) */
export function timingCalApply(o: TimingCalOutcome): { audioOffsetMs: number; kickOffsetMs: number | null } | null {
  if (o.stick.status !== 'ok' || o.stick.offsetMs === null) return null;
  const kickOk = o.kick !== null && o.kick.status === 'ok' && o.kick.offsetMs !== null;
  return { audioOffsetMs: o.stick.offsetMs, kickOffsetMs: kickOk ? o.kick!.offsetMs : null };
}
