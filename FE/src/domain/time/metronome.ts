// 메트로놈 순수 로직: BPM 클램프, 박 시각·현재 박 계산, BPM 변경 시 기준점 재설정, 탭 템포, 박 분할(4분·8분) 틱 계산.
// 타이머·오디오·React를 모른다. 시각은 모두 ms(performance.now 축).

export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const BPM_DEFAULT = 120;
export const BPM_STEP = 5;
export type BeatsPerBar = 3 | 4;
/** 탭 간격이 이 이상 벌어지면 누적을 버린다 */
export const TAP_RESET_MS = 2000;
/** 최근 탭 최대 보관 수(간격 최대 7개) */
export const TAP_MAX = 8;
/** BPM을 내기 시작하는 최소 탭 수(간격 1개) */
export const TAP_MIN = 2;

/** 박당 클릭 수(설계 MODE-002-MODE-003-metronome-subdivision). 1 = 4분음표, 2 = 8분음표 */
export type Subdivision = 1 | 2;
/** 사용자가 고른 박 분할(저장되는 값). auto는 기준 BPM으로 푼다 */
export type SubdivisionPref = 'auto' | 'quarter' | 'eighth';
export const SUBDIVISION_PREFS: readonly SubdivisionPref[] = ['auto', 'quarter', 'eighth'];
/** 클릭 소리 단계: 마디 첫 박 · 정박 · 사이 박 */
export type ClickLevel = 'accent' | 'beat' | 'sub';
/** 자동이 8분음표로 바뀌는 경계. 기준 BPM이 이 값 미만이면 8분 */
export const AUTO_EIGHTH_BELOW_BPM = 90;
/** 선택 칸 문구. Dock 패널·설정·시작 확인 창이 같은 문구를 쓴다 */
export const SUBDIVISION_LABEL: Record<SubdivisionPref, string> = { auto: '자동', quarter: '4분음표', eighth: '8분음표' };
/** 풀이 문구의 기준: 곡(song) BPM인지, 자유 연습 메트로놈(metronome) BPM인지 */
export type SubdivisionPlace = 'song' | 'metronome';
/** 분할을 고르면 들려주는 예시 소리의 길이(박) */
export const PREVIEW_BEATS = 2;

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

/** 예약 단위 하나. 틱 t의 박 위치 = t ÷ 분할. 사이 박의 beatInBar는 속한 박의 번호 */
export interface TickInfo {
  tick: number;
  beatInBar: number;
  level: ClickLevel;
  /** 정박인지(박 표시·onBeat는 정박에만) */
  isBeat: boolean;
  atMs: number;
}

export interface TapState {
  taps: number[];
}

export function isSubdivisionPref(v: unknown): v is SubdivisionPref {
  return v === 'auto' || v === 'quarter' || v === 'eighth';
}

/** 고른 값을 박당 클릭 수로 푼다. auto는 기준 BPM이 AUTO_EIGHTH_BELOW_BPM 미만이면 8분. BPM이 숫자가 아니면 4분 */
export function resolveSubdivision(pref: SubdivisionPref, bpm: number): Subdivision {
  if (pref === 'eighth') return 2;
  if (pref === 'quarter') return 1;
  return Number.isFinite(bpm) && bpm < AUTO_EIGHTH_BELOW_BPM ? 2 : 1;
}

/**
 * 고른 값이 지금 어떻게 울리는지 한 줄. 자동은 기준 BPM으로 풀어 적는다(곡이면 「BPM 72 곡이라 …」, 메트로놈이면 「지금 BPM에서는 …」).
 * 자동인데 BPM을 모르면 빈 문자열
 */
export function subdivisionHint(pref: SubdivisionPref, bpm: number | undefined, place: SubdivisionPlace): string {
  if (pref === 'quarter') return '박마다 한 번 울려요';
  if (pref === 'eighth') return '박 사이에 한 번 더 울려요';
  if (bpm === undefined || !Number.isFinite(bpm)) return '';
  const name = SUBDIVISION_LABEL[resolveSubdivision('auto', bpm) === 2 ? 'eighth' : 'quarter'];
  return place === 'song' ? `BPM ${Math.round(bpm)} 곡이라 ${name}로 울려요` : `지금 BPM에서는 ${name}로 울려요`;
}

/** 예시 소리의 틱 하나. beat는 정박이면 0부터의 박 번호, 사이 박이면 null */
export interface PreviewTick {
  offsetMs: number;
  level: ClickLevel;
  beat: number | null;
}

/** 예시 소리(PREVIEW_BEATS박)의 틱 목록. 첫 틱만 강세다. BPM이 숫자가 아니거나 0 이하면 빈 목록 */
export function previewTicks(bpm: number, subdivision: Subdivision): PreviewTick[] {
  if (!Number.isFinite(bpm) || bpm <= 0) return [];
  const out: PreviewTick[] = [];
  for (let t = 0; t < PREVIEW_BEATS * subdivision; t++) {
    const isBeat = t % subdivision === 0;
    out.push({
      offsetMs: (t / subdivision) * beatIntervalMs(bpm),
      level: !isBeat ? 'sub' : t === 0 ? 'accent' : 'beat',
      beat: isBeat ? t / subdivision : null,
    });
  }
  return out;
}

/** 틱의 마디 안 위치와 소리 단계. 분할의 배수인 틱이 정박이다(시각은 호출자가 박 위치 = 틱 ÷ 분할로 구한다) */
export function tickPosition(
  tick: number,
  subdivision: Subdivision,
  beatsPerBar: number,
): Pick<TickInfo, 'beatInBar' | 'level' | 'isBeat'> {
  const beat = Math.floor(tick / subdivision);
  const beatInBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const isBeat = tick % subdivision === 0;
  return { beatInBar, isBeat, level: !isBeat ? 'sub' : beatInBar === 0 ? 'accent' : 'beat' };
}

/** 틱 하나의 시각·위치. 박 시계의 기준점(anchorIndex)은 박 단위이고 소수일 수 있다 */
export function tickAt(clock: BeatClock, tick: number, subdivision: Subdivision): TickInfo {
  return {
    tick,
    ...tickPosition(tick, subdivision, clock.beatsPerBar),
    atMs: clock.anchorMs + (tick / subdivision - clock.anchorIndex) * beatIntervalMs(clock.bpm),
  };
}

/** fromTick부터 시각이 [fromMs, toMs)에 드는 틱 목록(beatsInWindow와 같은 규칙) */
export function ticksInWindow(
  clock: BeatClock,
  subdivision: Subdivision,
  fromMs: number,
  toMs: number,
  fromTick: number,
): TickInfo[] {
  const out: TickInfo[] = [];
  for (let t = fromTick; ; t++) {
    const info = tickAt(clock, t, subdivision);
    if (info.atMs >= toMs) break;
    if (info.atMs >= fromMs) out.push(info);
  }
  return out;
}

/**
 * 분할이 바뀔 때 다음 틱을 새 분할로 옮긴다. 같은 박 위치 이상에서 가장 가까운 틱(올림)이라
 * 8분 → 4분이면 다음 정박, 4분 → 8분이면 예약돼 있던 다음 박에서 이어진다
 */
export function retick(nextTick: number, from: Subdivision, to: Subdivision): number {
  return Math.ceil((nextTick * to) / from);
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

/** nowMs에 가장 최근에 울린 박의 인덱스. 기준점 전이면 기준점 바로 앞 박. 기준점이 사이 박(소수)이어도 정수 박을 돌려준다 */
export function beatIndexAt(clock: BeatClock, nowMs: number): number {
  if (nowMs < clock.anchorMs) return Math.ceil(clock.anchorIndex) - 1;
  return Math.floor(clock.anchorIndex + (nowMs - clock.anchorMs) / beatIntervalMs(clock.bpm));
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
 * nextIndex는 박 위치라 8분 분할의 사이 박이면 소수(n.5)다. nowMs는 시그니처 호환용(기준점은 nextIndex의 기존 시각이 정한다).
 */
export function rebaseBpm(clock: BeatClock, newBpm: number, _nowMs: number, nextIndex: number): BeatClock {
  return {
    anchorMs: clock.anchorMs + (nextIndex - clock.anchorIndex) * beatIntervalMs(clock.bpm),
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
