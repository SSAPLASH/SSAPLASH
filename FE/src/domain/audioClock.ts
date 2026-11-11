// 오디오 시계(AudioContext.currentTime)가 실제로 흐르는지 판단 (설계 MODE-001 오디오 시계 시작 대기 3장). 타이머·AudioContext를 모르는 순수 함수.
// 브라우저가 오디오 출력을 막 깨운 직후(첫 접속, 탭을 오래 숨겼다 복귀)에는 state가 running이어도 시계가 0.6~1.2초 흐르지 않는다.
// 그동안 클릭·반주를 예약하면 클릭이 몰리고 반주가 곡 내내 늦는다. 시작·재개 전에 이 판단이 참이 될 때까지 기다린다.

/** 표본을 읽는 간격(ms) */
export const CLOCK_POLL_MS = 20;
/** 흐름을 판단하는 구간 길이(ms) */
export const CLOCK_WINDOW_MS = 150;
/** 구간에서 오디오 시계가 화면 시계 경과의 이 비율 이상 흘러야 한다 */
export const CLOCK_FLOW_RATIO = 0.9;
/** 출력 시각(getOutputTimestamp)이 지금과 이 안이면 최신으로 본다(ms) */
export const OUTPUT_FRESH_MS = 100;
/** 출력 시각이 최신이 아니어도 시계가 이만큼 계속 흘렀으면 통과(ms). 출력 시각을 갱신하지 않는 브라우저용 */
export const CLOCK_STEADY_MS = 500;
/**
 * 이 시간 안에 소리를 낸 적이 있으면 출력 장치가 깨어 있다고 본다(ms).
 * Chrome은 출력이 한동안(측정: 30초는 무사, 45초부터) 조용하면 장치를 쉬게 하고, 다음 첫 소리가 나기 시작한 0.06~0.15초 뒤에 오디오 시계가 0.4~0.8초 멈춘다.
 * 소리를 내기 전에는 시계가 멀쩡히 흐르므로 clockFlowing만으로는 알 수 없다.
 */
export const SOUND_RECENT_MS = 20_000;
/** 장치를 깨우는 신호를 튼 뒤 최소 이만큼은 기다린다(ms). 멈춤이 시작되기(최대 0.15초) 전에 통과하지 않게 한다 */
export const PRIMED_MIN_WAIT_MS = 350;
/** 최대 대기(ms). 넘으면 그냥 시작한다 */
export const CLOCK_WAIT_MAX_MS = 3000;
/** 곡 도중 (화면 시계 − 오디오 시계)가 직전보다 이만큼 넘게 커지면 오디오 시계가 멈췄던 것으로 본다(ms). 진단 기록용 */
export const CLOCK_STALL_MS = 50;

export interface ClockSample {
  /** performance.now() */
  perfMs: number;
  /** AudioContext.currentTime(초) */
  ctxSec: number;
  /** getOutputTimestamp().performanceTime. 없거나 0이면 null */
  outPerfMs: number | null;
}

/** 가장 최근 표본을 끝으로 하고 길이가 spanMs 이상인 가장 짧은 구간에서 오디오 시계가 충분히 흘렀는지. 그런 구간이 없으면 거짓 */
function flowedOver(samples: readonly ClockSample[], spanMs: number): boolean {
  const last = samples[samples.length - 1];
  for (let i = samples.length - 2; i >= 0; i--) {
    const dPerf = last.perfMs - samples[i].perfMs;
    if (dPerf < spanMs) continue;
    return (last.ctxSec - samples[i].ctxSec) * 1000 >= CLOCK_FLOW_RATIO * dPerf;
  }
  return false;
}

/**
 * 오디오 시계가 흐르고 있는지. 표본은 시간순(오래된 것 먼저).
 * 최근 150ms에 90% 이상 흘렀고, 출력 시각이 최신(100ms 안)이거나 최근 500ms 내내 90% 이상 흘렀으면 참.
 */
export function clockFlowing(samples: readonly ClockSample[]): boolean {
  if (samples.length < 2 || !flowedOver(samples, CLOCK_WINDOW_MS)) return false;
  const last = samples[samples.length - 1];
  const fresh = last.outPerfMs !== null && Math.abs(last.perfMs - last.outPerfMs) <= OUTPUT_FRESH_MS;
  return fresh || flowedOver(samples, CLOCK_STEADY_MS);
}

/** 곡 도중 오디오 시계가 멈췄다 흐른 흔적인지. 인자는 (화면 시계 ms − 오디오 시계 초×1000)의 직전 값과 지금 값 */
export function clockStalled(prevOffsetMs: number | null, offsetMs: number): boolean {
  return prevOffsetMs !== null && offsetMs - prevOffsetMs > CLOCK_STALL_MS;
}
