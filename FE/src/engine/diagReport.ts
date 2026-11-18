// 연주 화면(PlayPage·SheetPage)이 판정 결과와 세션 상태를 알리는 얇은 접착 코드.
// 텔레메트리(pushTelemetry)와 진단 탭(diagTap) 호출을 한 곳에 묶어, 새 모드를 추가해도 한 줄만 부르면 되게 한다(설계 R6).
// 판정 경로는 바꾸지 않는다: 값을 읽어 내보내기만 한다.
import type { ResolvedHit } from '@/domain/events';
import type { TimingWindows } from '@/domain/play/judgement';
import type { PadAnchor } from '@/domain/kit/calibration/calibration';
import type { PadId } from '@/domain/kit/pads';
import { diagTap, judgementToDiag, type DiagAnchor, type DiagBody } from './diagTap';
import type { JudgementEvent, RhythmSession } from './RhythmSession';
import { pushTelemetry } from './telemetry';

/**
 * 타격 하나의 판정 결과를 텔레메트리와 진단 탭에 낸다.
 * session은 채점이 켜져 있을 때(연주 중·일시정지 아님)만 넘긴다. 없으면 judged를 내지 않는다.
 * ev가 없으면(채보 밖) judgement 없는 judged, 곧 stray다.
 */
export function reportHit(hit: ResolvedHit, ev: JudgementEvent | null, session: RhythmSession | null): void {
  pushTelemetry(hit, ev ? { judgement: ev.judgement, deltaMs: ev.deltaMs ?? undefined } : undefined);
  if (!session || !diagTap.active) return;
  diagTap.publish({
    type: 'judged',
    hitId: hit.id,
    judgement: ev ? ev.judgement : null,
    noteIndex: ev ? ev.noteIndex : null,
    notePad: ev ? ev.pad : null,
    hitPad: hit.pad,
    deltaMs: ev ? ev.deltaMs : null,
    songTimeMs: session.songTime(hit.tHit),
  });
  const c = session.lastContestedMatch;
  if (c && c.hitId === hit.id) diagTap.publish({ type: 'matchContested', ...c });
}

interface ActiveSession {
  ss: RhythmSession;
  mode: 'RHYTHM' | 'SHEET';
  windows: TimingWindows;
  audioOffsetMs: number;
  kickOffsetMs: number;
  /** 이 판의 타격 진동 방식 */
  haptic: 'judgement' | 'local';
  /** onJudgement 구독 해제(missed 파생) */
  off: () => void;
}

/** 지금 진단을 내보내는 세션. 페이지가 start/end를 부른다 */
let active: ActiveSession | null = null;

function sessionBody(a: ActiveSession, phase: 'start' | 'pause' | 'resume' | 'end', reason?: 'finished' | 'left'): DiagBody {
  const c = a.ss.chart;
  const snap = phase === 'end' ? a.ss.snapshot() : null;
  return {
    type: 'session',
    phase,
    mode: a.mode,
    songId: c.songId,
    title: c.title,
    chartVersionId: c.chartVersionId ?? null,
    windows: a.windows,
    audioOffsetMs: a.audioOffsetMs,
    kickOffsetMs: a.kickOffsetMs,
    haptic: a.haptic,
    noteCount: a.ss.notes.length,
    reason,
    summary: snap
      ? {
          score: snap.score,
          maxScore: snap.maxScore,
          combo: snap.combo,
          maxCombo: snap.maxCombo,
          counts: snap.counts,
          strayHits: snap.strayHits,
          contestedHits: snap.contestedHits,
          judgedCount: snap.judgedCount,
        }
      : undefined,
  };
}

/** 손 하나의 앵커 집합(판정 프로필의 anchors). null = 그 손 보정 안 됨 */
export type DiagHandAnchors = Partial<Record<PadId, PadAnchor>> | null;

export interface DiagSessionOpts {
  windows: TimingWindows;
  audioOffsetMs: number;
  /** 발 타격에 적용한 킥 값(풀린 값). 따로 재지 않았으면 audioOffsetMs와 같다 */
  kickOffsetMs: number;
  /** 이 판의 타격 진동 방식(PLAY-006). 없으면 판정 진동 */
  haptic?: 'judgement' | 'local';
  /** 손별 앵커(0 왼손, 1 오른손). 반경이 계산된 판정 프로필 값을 넘긴다. 없으면 anchors 줄을 내지 않는다 */
  anchors?: [DiagHandAnchors, DiagHandAnchors];
  calibratedAt?: number | null;
  presetId?: string | null;
}

function toDiagAnchors(set: DiagHandAnchors): DiagAnchor[] | null {
  if (!set) return null;
  const out: DiagAnchor[] = [];
  for (const a of Object.values(set)) {
    if (a) out.push({ pad: a.pad, pitch: a.pitch, yaw: a.yaw, radius: a.radius, samples: a.samples, spread: a.spread });
  }
  return out;
}

/** 곡 시작 직후 부를 훅(1개). app/bootstrap이 clock 줄 발행을 건다(engine은 입력 소스를 모른다) */
let sessionStartHook: (() => void) | null = null;
export function onDiagSessionStart(cb: (() => void) | null): void {
  sessionStartHook = cb;
}

/** 곡 시작 직후 부를 훅을 더한다(여러 개). clock 줄 뒤에 등록 순서대로 부른다. 반환값은 해제 함수 */
const sessionStartExtras = new Set<() => void>();
export function addDiagSessionStartHook(cb: () => void): () => void {
  sessionStartExtras.add(cb);
  return () => sessionStartExtras.delete(cb);
}

/**
 * 곡 시작(재시작 포함)마다 부를 훅을 더한다. 진단 구독 여부와 무관하게 돈다(앱 동작이 걸린 훅용).
 * addDiagSessionStartHook은 진단 구독 중에만 돈다. 반환값은 해제 함수
 */
const playStartHooks = new Set<() => void>();
export function addPlayStartHook(cb: () => void): () => void {
  playStartHooks.add(cb);
  return () => playStartHooks.delete(cb);
}

/** 진행 중인 판의 판정 타이밍 보정(ms). 판이 없으면 null */
export function diagActiveAudioOffsetMs(): number | null {
  return active ? active.audioOffsetMs : null;
}

/** 진행 중인 판의 발 타격 보정(ms). 판이 없으면 null */
export function diagActiveKickOffsetMs(): number | null {
  return active ? active.kickOffsetMs : null;
}

/** 곡 시작(재시작 포함). 노트 배열·앵커 표를 1회 내보내고, MISS 노트를 missed로 파생하는 구독을 건다 */
export function diagSessionStart(ss: RhythmSession, mode: 'RHYTHM' | 'SHEET', opts: DiagSessionOpts): void {
  active?.off();
  const off = ss.onJudgement((e) => {
    if (!diagTap.active) return;
    const d = judgementToDiag(ss, e);
    if (d) diagTap.publish(d);
  });
  active = { ss, mode, windows: opts.windows, audioOffsetMs: opts.audioOffsetMs, kickOffsetMs: opts.kickOffsetMs, haptic: opts.haptic ?? 'judgement', off };
  for (const cb of playStartHooks) cb();
  if (!diagTap.active) return;
  diagTap.publish(sessionBody(active, 'start'));
  diagTap.publish({
    type: 'notes',
    songId: ss.chart.songId,
    notes: ss.chart.notes.map((n) => ({ timeMs: n.timeMs, pad: n.pad })),
  });
  if (opts.anchors) {
    diagTap.publish({
      type: 'anchors',
      hands: [toDiagAnchors(opts.anchors[0]), toDiagAnchors(opts.anchors[1])],
      calibratedAt: opts.calibratedAt ?? null,
      presetId: opts.presetId ?? null,
    });
  }
  sessionStartHook?.();
  for (const cb of sessionStartExtras) cb();
}

/** 일시정지·재개 */
export function diagSessionPhase(phase: 'pause' | 'resume'): void {
  if (!active || !diagTap.active) return;
  diagTap.publish(sessionBody(active, phase));
}

/** 종료(끝까지 침 / 나감·페이지 이탈). 진행 중인 세션이 없으면 아무것도 하지 않는다 */
export function diagSessionEnd(reason: 'finished' | 'left'): void {
  const a = active;
  if (!a) return;
  active = null;
  a.off();
  if (diagTap.active) diagTap.publish(sessionBody(a, 'end', reason));
}
