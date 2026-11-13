// 곡 선택 안내 애니메이션의 시간표 (설계 MODE-001-MODE-003-song-picker-guide 2·3장, 11/10 악보 모드 목업).
// 예시 한 마디(8분 8칸)를 ① 하나씩 보기(칸마다 멈춤) → ② 72 BPM으로 이어서 → 반복으로 돌린다.
// 시각(ms) → 장면 상태를 내는 순수 함수만 둔다. DOM·시간 읽기 없음 — 시계는 components/picker/guide/useGuideClock이 맡는다.
import type { PadId } from '@/domain/kit/pads';

/** 예시 한 칸. 같은 칸 패드는 동시에 친다 */
export interface GuideStep {
  pads: PadId[];
  /** 마디 안 8분 단위 위치 0~7 */
  beat: number;
}

/** ① 하나씩 보기 · ② 박에 맞춰 이어서 */
export type GuidePhase = 'step' | 'run';

export interface GuideState {
  phase: GuidePhase;
  /** 커서(악보) 또는 노트 낙하 기준 위치 0~1. CURSOR_START_POS~CURSOR_END_POS를 선형으로 편 값 */
  progress: number;
  /** 지금 치는 칸(steps 인덱스). 치는 중이 아니면 null */
  active: number | null;
  /** 이미 친 칸 */
  done: ReadonlySet<number>;
  /** 이동 중일 때 다음에 닿을 칸. 치는 중이거나 더 없으면 null */
  next: number | null;
}

type SegmentKind = 'move' | 'hold' | 'run';

/** 시간표 한 구간. 위치(pos)는 8분 단위(음표 i = beat i)다 */
export interface GuideSegment {
  phase: GuidePhase;
  kind: SegmentKind;
  t0: number;
  d: number;
  p0: number;
  /** move만 쓴다 */
  p1: number;
  /** ①의 칸 멈춤 구간이 가리키는 칸 */
  step?: number;
  /** ② 시작 전 커서를 처음으로 되돌려 놓는 구간 */
  reset?: boolean;
}

export interface GuideScript {
  steps: readonly GuideStep[];
  bpm: number;
  segments: readonly GuideSegment[];
  totalMs: number;
  /** 칸 i의 멈춤 시작 시각(ms) */
  holdStart: readonly number[];
  /** 위치 0이 되는 진행 시작·끝(8분 단위). progress = (pos − startPos) ÷ (endPos − startPos) */
  startPos: number;
  endPos: number;
  /** ②에서 커서가 첫 음표까지 가는 시간 */
  leadMs: number;
  /** ② 한 마디 길이 */
  barMs: number;
}

/** ① 칸 사이 이동 시간 */
export const MOVE_MS = 650;
/** ① 칸마다 멈춰 있는 시간 */
export const HOLD_MS = 1500;
/** ② 음표 시각에서 「치는 중」으로 보는 창 */
export const HIT_WINDOW_MS = 220;
export const GUIDE_BPM = 72;
const BEATS_PER_BAR = 4;
/** 한 마디의 8분 칸 수 */
export const STEPS_PER_BAR = 8;
/** 커서 시작·끝 위치(8분 단위). 악보 장면 가로폭(첫 음표~마디 끝 600px) 기준으로 첫 음표 22px 앞, 마디 끝 16px 뒤 */
export const CURSOR_START_POS = -22 / 75;
export const CURSOR_END_POS = 616 / 75;
/** 다음 칸 판정 여유(8분 단위, 장면 1px) */
const NEXT_EPS = 8 / 600;

const A_END_HOLD_MS = 900;
const B_RESET_MS = 900;
const B_END_HOLD_MS = 1400;

const H = 'HIHAT' as const;
/** 예시 8칸: 1박 크래시+킥 · 하이햇 8분 · 2·4박 스네어 · 3박·3박 반 킥 */
export const EXAMPLE_STEPS: readonly GuideStep[] = (
  [
    ['CRASH', 'KICK'],
    [H],
    [H, 'SNARE'],
    [H],
    [H, 'KICK'],
    [H, 'KICK'],
    [H, 'SNARE'],
    [H],
  ] as PadId[][]
).map((pads, beat) => ({ pads, beat }));

/** 시간표 옵션. 기본값은 악보 장면(커서)용이고, 리듬 게임 장면은 노트가 위에서 내려올 거리를 위해 시작 위치를 더 앞에 둔다 */
export interface GuideScriptOptions {
  startPos?: number;
  endPos?: number;
  /** ① 처음 이동 시간(ms). 기본 MOVE_MS */
  firstMoveMs?: number;
}

/** 리듬 게임 안내 장면 시간표 옵션: 노트가 판정선 위 4칸(8분 단위)에서 내려오기 시작한다 */
export const GAME_GUIDE_OPTIONS: GuideScriptOptions = { startPos: -4, endPos: 8, firstMoveMs: 1400 };

export function buildGuideScript(
  steps: readonly GuideStep[] = EXAMPLE_STEPS,
  bpm: number = GUIDE_BPM,
  options: GuideScriptOptions = {},
): GuideScript {
  const startPos = options.startPos ?? CURSOR_START_POS;
  const endPos = options.endPos ?? CURSOR_END_POS;
  const barMs = (BEATS_PER_BAR * 60000) / bpm;
  const leadMs = (-startPos / STEPS_PER_BAR) * barMs;
  const segments: GuideSegment[] = [];
  const holdStart: number[] = [];
  let total = 0;
  const push = (s: Omit<GuideSegment, 't0' | 'p1'> & { p1?: number }) => {
    segments.push({ p1: s.p0, ...s, t0: total });
    total += s.d;
  };
  let pos = startPos;
  steps.forEach((s, i) => {
    push({ phase: 'step', kind: 'move', d: i === 0 ? (options.firstMoveMs ?? MOVE_MS) : MOVE_MS, p0: pos, p1: s.beat });
    holdStart[i] = total;
    push({ phase: 'step', kind: 'hold', d: HOLD_MS, p0: s.beat, step: i });
    pos = s.beat;
  });
  push({ phase: 'step', kind: 'move', d: MOVE_MS, p0: pos, p1: endPos });
  push({ phase: 'step', kind: 'hold', d: A_END_HOLD_MS, p0: endPos });
  push({ phase: 'run', kind: 'hold', d: B_RESET_MS, p0: startPos, reset: true });
  push({ phase: 'run', kind: 'run', d: leadMs + barMs, p0: startPos });
  push({ phase: 'run', kind: 'hold', d: B_END_HOLD_MS, p0: endPos });
  return { steps, bpm, segments, totalMs: total, holdStart, startPos, endPos, leadMs, barMs };
}

/** 입력 u(0~1)의 ease-in-out. 칸 사이 이동에 쓴다 */
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

const progressOf = (script: GuideScript, pos: number) => (pos - script.startPos) / (script.endPos - script.startPos);

/** 시각 t(ms, 루프 포함) → 장면 상태 */
export function stateAt(script: GuideScript, t: number): GuideState {
  const total = script.totalMs;
  const tm = ((t % total) + total) % total;
  const segs = script.segments;
  const seg = segs.find((g) => tm >= g.t0 && tm < g.t0 + g.d) ?? segs[segs.length - 1];
  const u = (tm - seg.t0) / seg.d;
  const steps = script.steps;
  let pos: number;
  let active: number | null = null;
  const done = new Set<number>();

  if (seg.phase === 'step') {
    pos = seg.kind === 'move' ? seg.p0 + (seg.p1 - seg.p0) * ease(u) : seg.p0;
    if (seg.kind === 'hold' && seg.step !== undefined) active = seg.step;
    steps.forEach((_, i) => {
      if (tm >= script.holdStart[i] + HOLD_MS) done.add(i);
    });
  } else if (seg.reset) {
    pos = seg.p0;
  } else if (seg.kind === 'run') {
    pos = Math.min(script.endPos, script.startPos + ((tm - seg.t0) / script.barMs) * STEPS_PER_BAR);
    const e = tm - seg.t0 - script.leadMs; // 0 = 첫 음표 시각
    steps.forEach((s, i) => {
      const dt = e - (script.barMs * s.beat) / STEPS_PER_BAR;
      if (dt >= 0 && dt < HIT_WINDOW_MS) active = i;
      if (dt >= HIT_WINDOW_MS) done.add(i);
    });
  } else {
    pos = seg.p0;
    steps.forEach((_, i) => done.add(i));
  }

  const nx = steps.findIndex((s) => s.beat > pos + NEXT_EPS);
  return { phase: seg.phase, progress: progressOf(script, pos), active, done, next: active === null && nx >= 0 ? nx : null };
}

/** 칸 i의 멈춤 시작 시각(ms). ◀ ▶ 한 칸 이동이 이 시각 +1ms로 시계를 옮긴다 */
export function holdStartOf(script: GuideScript, i: number): number {
  return script.holdStart[Math.max(0, Math.min(script.steps.length - 1, i))];
}

/** ◀(dir -1)·▶(+1)가 옮겨 갈 칸. ②에서 누르면 ①의 처음·끝에서 한 칸 가는 것으로 본다 */
export function stepTarget(script: GuideScript, state: GuideState, dir: 1 | -1): number {
  const n = script.steps.length;
  let cur: number;
  if (state.phase !== 'step') cur = dir > 0 ? -1 : n;
  else if (state.active !== null) cur = state.active;
  else cur = state.next === null ? n : dir > 0 ? state.next - 1 : state.next;
  return Math.max(0, Math.min(n - 1, cur + dir));
}
