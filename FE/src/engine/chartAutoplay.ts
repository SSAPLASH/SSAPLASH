// 채보 확인 재생(T2, 진단 빌드 전용). 사람·센서 없이 채보 노트를 세션 곡 시각 기준으로 드럼 소리로 예약한다.
// 판정에는 아무것도 넣지 않는다(소리만 낸다). audio는 import하지 않는다 — 소리 함수는 deps로 주입받는다.
import type { ChartNote } from '@/domain/chart';
import type { PadId } from '@/domain/pads';

/** 노트를 미리 예약하는 선행 시간(PlayClock과 같은 값) */
export const AUTOPLAY_LOOKAHEAD_MS = 200;
/** 탭이 숨겨져 타이머가 느려질 때의 선행 시간 */
export const AUTOPLAY_HIDDEN_LOOKAHEAD_MS = 1200;
/** 예약 타이머 간격(PlayClock의 SCHEDULE_TICK_MS와 같은 값) */
export const AUTOPLAY_TICK_MS = 25;
/** 이만큼 넘게 지난 노트는 울리지 않고 건너뛴다 */
export const AUTOPLAY_SKIP_MS = 50;
/** velocityHint가 없을 때의 세기 */
export const AUTOPLAY_DEFAULT_VELOCITY = 100;

export interface ChartAutoplayDeps {
  /** 시간순 노트 목록(timeMs 오름차순) */
  notes: readonly ChartNote[];
  /** 지금의 세션 곡 시각(ms). 시계가 돌고 있지 않으면(일시정지·정지·종료) null */
  songTime(): number | null;
  /** 소리 예약. atMs는 울릴 performance.now 시각. 취소 함수를 돌려주면 일시정지·정지 때 아직 안 울린 소리를 취소한다 */
  play(pad: PadId, velocity: number, atMs: number): (() => void) | void;
  now?(): number;
  /** 타이머 주입(테스트용). 기본 globalThis */
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(id: unknown): void;
  visibility?(): 'visible' | 'hidden';
}

export interface ChartAutoplay {
  start(): void;
  stop(): void;
}

export function createChartAutoplay(deps: ChartAutoplayDeps): ChartAutoplay {
  const { notes } = deps;
  const now = () => (deps.now ? deps.now() : performance.now());
  let timer: unknown = null;
  /** 다음에 예약할 노트 인덱스 */
  let cursor = 0;
  /** 직전 tick의 곡 시각. null이면 시계가 멈춰 있었음(재개·재시작 직후 커서를 다시 잡는다) */
  let lastT: number | null = null;
  /** 예약했지만 아직 울릴 시각이 안 된 소리(취소용) */
  let pending: { atMs: number; cancel: () => void }[] = [];

  /** 아직 안 울린 예약 소리를 취소한다. 재개 때 같은 노트를 다시 예약하므로 일시정지 중에 울리지 않게 한다 */
  const cancelPending = (): void => {
    const nowMs = now();
    for (const p of pending) if (p.atMs > nowMs) p.cancel();
    pending = [];
  };

  const lookahead = (): number => {
    const v = deps.visibility
      ? deps.visibility()
      : typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? 'hidden'
        : 'visible';
    return v === 'hidden' ? AUTOPLAY_HIDDEN_LOOKAHEAD_MS : AUTOPLAY_LOOKAHEAD_MS;
  };

  /** 곡 시각 t 이후(포함) 첫 노트 인덱스 */
  const firstFrom = (t: number): number => {
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].timeMs < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const tick = (): void => {
    const t = deps.songTime();
    if (t === null) {
      if (lastT !== null) cancelPending();
      lastT = null;
      return;
    }
    // 멈췄다 재개했거나 곡 시각이 뒤로 갔으면(재시작) 현재 곡 시각부터 다시 시작한다. 지난 노트는 울리지 않는다
    if (lastT === null || t < lastT) cursor = firstFrom(t);
    lastT = t;
    const nowMs = now();
    pending = pending.filter((p) => p.atMs > nowMs);
    const ahead = lookahead();
    while (cursor < notes.length && notes[cursor].timeMs <= t + ahead) {
      const n = notes[cursor];
      cursor += 1;
      if (n.timeMs < t - AUTOPLAY_SKIP_MS) continue; // 타이머가 늦어 놓친 노트
      const atMs = nowMs + (n.timeMs - t);
      const cancel = deps.play(n.pad, n.velocityHint ?? AUTOPLAY_DEFAULT_VELOCITY, atMs);
      if (cancel) pending.push({ atMs, cancel });
    }
  };

  return {
    start() {
      if (timer !== null) return;
      cursor = 0;
      lastT = null;
      const si = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
      timer = si(tick, AUTOPLAY_TICK_MS);
      tick();
    },
    stop() {
      if (timer === null) return;
      const ci = deps.clearInterval ?? ((id) => globalThis.clearInterval(id as number));
      ci(timer);
      timer = null;
      cancelPending();
    },
  };
}
