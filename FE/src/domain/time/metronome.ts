// 메트로놈 순수 로직: BPM 클램프, 박 시각·현재 박 계산, BPM 변경 시 기준점 재설정, 탭 템포.
// 타이머·오디오·React를 모른다. 시각은 모두 ms(performance.now 축).

export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const BPM_DEFAULT = 120;
export const BPM_STEP = 5;
export const BEATS_PER_BAR_OPTIONS = [4, 3] as const;
export type BeatsPerBar = 3 | 4;
/** 탭 간격이 이 이상 벌어지면 누적을 버린다 */
export const TAP_RESET_MS = 2000;
/** 최근 탭 최대 보관 수(간격 최대 7개) */
export const TAP_MAX = 8;
/** BPM을 내기 시작하는 최소 탭 수(간격 1개) */
export const TAP_MIN = 2;

/** 박 anchorIndex가 anchorMs에 울린다는 기준점. 박 i의 시각 = anchorMs + (i − anchorIndex) × 60000 / bpm */
export interface BeatClock {
  anchorMs: number;
  anchorIndex: number;
  bpm: number;
  beatsPerBar: BeatsPerBar;
}

export interface BeatInfo {
  index: number;
  beatInBar: number;
  accent: boolean;
  atMs: number;
}

export interface TapState {
  taps: number[];
}

/** 범위로 자르고 정수로 반올림. NaN이면 기본값 */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return BPM_DEFAULT;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
}

export function beatIntervalMs(bpm: number): number {
  return 60000 / bpm;
}

export function beatAt(clock: BeatClock, index: number): BeatInfo {
  const beatInBar = ((index % clock.beatsPerBar) + clock.beatsPerBar) % clock.beatsPerBar;
  return {
    index,
    beatInBar,
    accent: beatInBar === 0,
    atMs: clock.anchorMs + (index - clock.anchorIndex) * beatIntervalMs(clock.bpm),
  };
}

/** nowMs에 가장 최근에 울린 박의 인덱스. 시작 전이면 anchorIndex − 1 */
export function beatIndexAt(clock: BeatClock, nowMs: number): number {
  if (nowMs < clock.anchorMs) return clock.anchorIndex - 1;
  return clock.anchorIndex + Math.floor((nowMs - clock.anchorMs) / beatIntervalMs(clock.bpm));
}

/** fromIndex부터 시각이 [fromMs, toMs)에 드는 박 목록 */
export function beatsInWindow(clock: BeatClock, fromMs: number, toMs: number, fromIndex: number): BeatInfo[] {
  const out: BeatInfo[] = [];
  for (let i = fromIndex; ; i++) {
    const b = beatAt(clock, i);
    if (b.atMs >= toMs) break;
    if (b.atMs >= fromMs) out.push(b);
  }
  return out;
}

/**
 * BPM(·박자) 변경. 아직 안 울린 다음 박(nextIndex)의 시각을 그대로 두고 그 박을 새 기준점으로 삼는다.
 * nowMs는 시그니처 호환용(기준점은 nextIndex의 기존 시각이 정한다).
 */
export function rebaseBpm(clock: BeatClock, newBpm: number, _nowMs: number, nextIndex: number): BeatClock {
  return {
    anchorMs: beatAt(clock, nextIndex).atMs,
    anchorIndex: nextIndex,
    bpm: clampBpm(newBpm),
    beatsPerBar: clock.beatsPerBar,
  };
}

/** 직전 탭과 TAP_RESET_MS 이상 벌어지면 리셋, 아니면 추가하고 TAP_MAX개만 남긴다 */
export function pushTap(state: TapState, nowMs: number): TapState {
  const last = state.taps[state.taps.length - 1];
  if (last === undefined || nowMs - last >= TAP_RESET_MS) return { taps: [nowMs] };
  return { taps: [...state.taps, nowMs].slice(-TAP_MAX) };
}

/** 탭이 TAP_MIN 미만이면 null. 아니면 인접 간격 평균의 역수를 클램프 */
export function tapBpm(state: TapState): number | null {
  const t = state.taps;
  if (t.length < TAP_MIN) return null;
  const avg = (t[t.length - 1] - t[0]) / (t.length - 1);
  if (!(avg > 0)) return null;
  return clampBpm(60000 / avg);
}
