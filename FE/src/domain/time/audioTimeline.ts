// 연주 시계를 오디오 시계 하나로 (설계 MODE-001 연주 시계를 오디오 시계 하나로 3장). AudioContext를 모르는 순수 함수.
// 곡 0ms를 오디오 시계 시각 하나(ctxZero)로 정하고, 반주·메트로놈 클릭은 그 시각 기준으로 오디오 시계에 바로 예약한다.
// 노트·판정의 곡 시각은 "지금 들리는 오디오 시계 시각 − ctxZero"로 구한다. 화면 시계는 프레임·타격 시각을 이 축에 올릴 때만 쓴다.

/** 오디오 시계 읽기 값. 같은 순간에 읽은 세 값 */
export interface AudioReading {
  /** performance.now() */
  perfMs: number;
  /** AudioContext.currentTime(초). 예약 기준. 출력 지연만큼 들리는 시각보다 앞선다 */
  ctxSec: number;
  /** 그 순간 스피커·이어폰에서 들리는 오디오 시계 시각(초) */
  heardCtxSec: number;
}

/** 클릭을 currentTime보다 이만큼 앞의 박까지 미리 예약한다(초). 오디오 시계 기준이라 출력 지연과 상관없다 */
export const CLICK_AHEAD_SEC = 0.2;
/** 탭이 가려져 타이머가 느려질 때(초) */
export const HIDDEN_CLICK_AHEAD_SEC = 1.2;
/** 이미 이만큼 넘게 지난 박은 클릭 없이 건너뛴다(초) */
export const CLICK_LATE_SKIP_SEC = 0.05;
/** 들리는 시각 추정값이 이보다 크게 바뀌면 바로 따라간다(ms). 안이면 조금씩 따라가 노트가 떨리지 않게 한다 */
export const HEARD_JUMP_MS = 15;
/** HEARD_JUMP_MS 안의 변화는 읽을 때마다 차이의 이 비율만큼 따라간다 */
export const HEARD_FOLLOW = 0.1;

/** 들리는 시각과 화면 시계의 차이(ms) = perfMs − heardCtxSec × 1000. 이 값이 변하지 않으면 두 시계가 같은 빠르기로 흐른다 */
export function heardOffsetMs(r: AudioReading): number {
  return r.perfMs - r.heardCtxSec * 1000;
}

/**
 * 차이 추정값을 고르게 따라간다. 처음(prev가 null)이거나 HEARD_JUMP_MS를 넘게 바뀌면 새 값 그대로,
 * 안이면 HEARD_FOLLOW 비율만큼만 옮긴다.
 */
export function smoothOffsetMs(prev: number | null, next: number): number {
  if (prev === null || !Number.isFinite(prev)) return next;
  const d = next - prev;
  if (Math.abs(d) > HEARD_JUMP_MS) return next;
  return prev + d * HEARD_FOLLOW;
}

/** 곡 시각(ms)을 울릴 오디오 시계 시각(초) */
export function songToContextSec(songMs: number, ctxZeroSec: number): number {
  return ctxZeroSec + songMs / 1000;
}

/** 오디오 시계 시각(초)이 들리는 화면 시계 시각(ms). offsetMs는 heardOffsetMs(고른 값) */
export function contextToHeardPerfMs(ctxSec: number, offsetMs: number): number {
  return offsetMs + ctxSec * 1000;
}

/**
 * 세션 startTime(곡 0ms가 들리는 화면 시계 시각)과 그때의 곡 시각.
 * 들리는 곡 시각 = nowPerf − (offsetMs + ctxZero × 1000). 곡 시각은 줄어들지 않게 직전 곡 시각(lastSongMs)보다 작으면 직전 값에 묶는다(held).
 * 묶인 동안은 세션이 그 값을 그대로 들고 있어야 한다. 화면 시계로 이어 셈하게 두면 다음 계산 때 다시 묶이며 곡 시각이 몇 ms씩 뒤로 돈다.
 * 그래서 오디오 시계가 멈추면 곡 시각도 멈추고(노트가 앞서 가지 않음), 다시 흐르면 같이 흐른다.
 */
export function sessionStartPerf(
  offsetMs: number,
  ctxZeroSec: number,
  nowPerf: number,
  lastSongMs: number | null,
): { startPerf: number; songMs: number; held: boolean } {
  const heardStart = contextToHeardPerfMs(ctxZeroSec, offsetMs);
  const heardSong = nowPerf - heardStart;
  if (lastSongMs !== null && heardSong < lastSongMs) {
    return { startPerf: nowPerf - lastSongMs, songMs: lastSongMs, held: true };
  }
  return { startPerf: heardStart, songMs: heardSong, held: false };
}

/** 오디오 시계가 화면 시계 경과의 이 비율보다 덜 흐르면 멈춘 것으로 본다 */
export const STALL_FLOW_RATIO = 0.5;
/** 멈춤을 판단하는 최소 간격(초) */
export const STALL_WINDOW_SEC = 0.05;

/** 들리는 시각 추정에 쓰는 직전 상태 */
export interface HeardState {
  perfMs: number;
  ctxSec: number;
  /** 오디오 시계가 정상으로 흐를 때의 currentTime − 들리는 시각(초) */
  gapSec: number;
  /** 마지막 판단에서 멈춘 것으로 봤는지 */
  stalled?: boolean;
}

/**
 * 멈춤을 반영한 들리는 오디오 시계 시각(초)과 다음 상태.
 * 출력 시각(getOutputTimestamp)은 멈춤 동안 갱신되지 않아 화면 시계로 이어 셈하면 계속 흐르는 것처럼 보인다.
 * 그래서 currentTime이 화면 시계 경과의 STALL_FLOW_RATIO보다 덜 흘렀으면 멈춘 것으로 보고 currentTime − 직전 간격으로 묶는다.
 * 정상으로 흐를 때는 간격을 새로 잡아 출력 지연이 바뀌는 것을 따라간다.
 */
export function stallAwareHeard(prev: HeardState | null, r: AudioReading): { heardCtxSec: number; state: HeardState; stalled: boolean } {
  const gap = r.ctxSec - r.heardCtxSec;
  if (prev === null) return { heardCtxSec: r.heardCtxSec, state: { perfMs: r.perfMs, ctxSec: r.ctxSec, gapSec: gap }, stalled: false };
  const dPerf = (r.perfMs - prev.perfMs) / 1000;
  const dCtx = r.ctxSec - prev.ctxSec;
  // currentTime은 오디오 처리 단위(수~수십 ms)로 계단처럼 오르므로 STALL_WINDOW_SEC보다 짧은 간격으로는 판단하지 않는다.
  // 그 사이에는 직전 판단(prev.stalled)을 이어 쓰고 상태는 바꾸지 않는다
  if (dPerf < STALL_WINDOW_SEC) {
    const heard = prev.stalled ? Math.min(r.heardCtxSec, r.ctxSec - prev.gapSec) : r.heardCtxSec;
    return { heardCtxSec: heard, state: prev, stalled: prev.stalled ?? false };
  }
  const stalled = dCtx < dPerf * STALL_FLOW_RATIO;
  if (stalled) {
    return {
      heardCtxSec: Math.min(r.heardCtxSec, r.ctxSec - prev.gapSec),
      state: { perfMs: r.perfMs, ctxSec: r.ctxSec, gapSec: prev.gapSec, stalled: true },
      stalled: true,
    };
  }
  return { heardCtxSec: r.heardCtxSec, state: { perfMs: r.perfMs, ctxSec: r.ctxSec, gapSec: gap, stalled: false }, stalled: false };
}
