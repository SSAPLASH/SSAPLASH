// 「인간 메트로놈」의 예비 박 예약기 (설계 MODE-006-minigame-tempo 3절 「예비 박 예약기」). 정해진 빠르기로 정해진 수의 클릭을 예약하고, 박마다와 끝날 때 알린다.
// 전역 메트로놈을 켜지 않는다(D16) — 켜면 사용자의 메트로놈 빠르기 설정이 바뀌고, 박 분할 설정에 따라 사이 박이 울리고, 정해진 박에서 정확히 멈추기 어렵다.
// 예약 방식은 전역 메트로놈·박 분할 예시 소리(runtime/metronomePreview)와 같다: 25ms마다 100ms 앞까지의 박을 예약하고 예약 여유에 renderAheadMs를 더한다.
// 측정은 하지 않는다. 화면이 `onEnd`를 받아 측정으로 넘어간다.
import { audioEngine } from '@/audio/AudioEngine';
import { beatIntervalMs, type ClickLevel } from '@/domain/time/metronome';
import { LOOKAHEAD_MS, TICK_MS } from '@/engine/Metronome';

/** 한 마디의 박 수. 마디의 첫 박(첫 박·다섯째 박)은 강세 소리다 */
const BEATS_PER_BAR = 4;

export interface CountInOptions {
  bpm: number;
  /** 울릴 박 수 */
  beats: number;
  /** 첫 박을 울릴 시각(`performance.now()` 축) */
  firstAt: number;
  /** 박이 울리는 때에 부른다. 번호는 0부터(화면의 박 점) */
  onBeat: (index: number) => void;
  /** 마지막 박에서 박 간격의 절반이 지난 때에 부른다. 인자는 마지막 박이 실제로 예약된 시각 */
  onEnd: (lastBeatAt: number) => void;
  /** 첫 박을 예약하지 못했을 때(오디오가 꺼져 있음) 부른다. 그 뒤로는 예약도 알림도 없다 */
  onFail: () => void;
  /** 아래는 테스트에서 바꿔 끼운다. 넘기지 않으면 audioEngine과 브라우저 타이머를 쓴다 */
  click?: (atMs: number, level: ClickLevel) => number | null;
  renderAheadMs?: () => number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export interface CountIn {
  /** 남은 박을 예약하지 않고 알림도 보내지 않는다. 이미 예약된 클릭 하나는 울릴 수 있다 */
  cancel: () => void;
}

export function startCountIn(options: CountInOptions): CountIn {
  const now = options.now ?? (() => performance.now());
  const click = options.click ?? ((atMs: number, level: ClickLevel) => audioEngine.click(atMs, level));
  const ahead = options.renderAheadMs ?? (() => audioEngine.renderAheadMs());
  const setI = options.setInterval ?? ((fn: () => void, ms: number): unknown => globalThis.setInterval(fn, ms));
  const clearI = options.clearInterval ?? ((id: unknown) => globalThis.clearInterval(id as number));
  const setT = options.setTimeout ?? ((fn: () => void, ms: number): unknown => globalThis.setTimeout(fn, ms));
  const clearT = options.clearTimeout ?? ((id: unknown) => globalThis.clearTimeout(id as number));
  const interval = beatIntervalMs(options.bpm);

  let next = 0;
  let cancelled = false;
  let lastAt = options.firstAt;
  let ticker: unknown = null;
  const timeouts = new Set<unknown>();

  const later = (fn: () => void, delayMs: number) => {
    const id: unknown = setT(
      () => {
        timeouts.delete(id);
        if (!cancelled) fn();
      },
      Math.max(0, delayMs),
    );
    timeouts.add(id);
  };
  const stopTicker = () => {
    if (ticker === null) return;
    clearI(ticker);
    ticker = null;
  };
  const cancel = () => {
    cancelled = true;
    stopTicker();
    for (const id of timeouts) clearT(id);
    timeouts.clear();
  };

  const schedule = () => {
    if (cancelled) return;
    const until = now() + LOOKAHEAD_MS + ahead();
    while (next < options.beats && options.firstAt + next * interval <= until) {
      const planned = options.firstAt + next * interval;
      const at = click(planned, next % BEATS_PER_BAR === 0 ? 'accent' : 'beat');
      if (at === null && next === 0) {
        // 오디오가 꺼져 있다. 부른 쪽의 준비가 끝난 뒤에 알리도록 한 박자 미룬다
        stopTicker();
        later(() => options.onFail(), 0);
        return;
      }
      // 도중에 예약이 안 되면(오디오가 멈춤) 계획한 시각으로 이어 간다
      const beatAt = at ?? planned;
      const index = next;
      later(() => options.onBeat(index), beatAt - now());
      lastAt = beatAt;
      next += 1;
    }
    if (next < options.beats) return;
    stopTicker();
    const endAt = lastAt;
    later(() => options.onEnd(endAt), endAt + interval / 2 - now());
  };

  ticker = setI(schedule, TICK_MS);
  schedule();
  return { cancel };
}
