// 연주 화면(PlayPage·SheetPage)이 판정 결과와 세션 상태를 알리는 얇은 접착 코드.
// 텔레메트리(pushTelemetry)와 진단 탭(diagTap) 호출을 한 곳에 묶어, 새 모드를 추가해도 한 줄만 부르면 되게 한다(설계 R6).
// 판정 경로는 바꾸지 않는다: 값을 읽어 내보내기만 한다.
import type { ResolvedHit } from '@/domain/events';
import type { TimingWindows } from '@/domain/judgement';
import { diagTap, judgementToDiag, type DiagBody } from './diagTap';
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
}

interface ActiveSession {
  ss: RhythmSession;
  mode: 'RHYTHM' | 'SHEET';
  windows: TimingWindows;
  audioOffsetMs: number;
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
          judgedCount: snap.judgedCount,
        }
      : undefined,
  };
}

/** 곡 시작(재시작 포함). 노트 배열을 1회 내보내고, MISS 노트를 missed로 파생하는 구독을 건다 */
export function diagSessionStart(
  ss: RhythmSession,
  mode: 'RHYTHM' | 'SHEET',
  opts: { windows: TimingWindows; audioOffsetMs: number },
): void {
  active?.off();
  const off = ss.onJudgement((e) => {
    if (!diagTap.active) return;
    const d = judgementToDiag(ss, e);
    if (d) diagTap.publish(d);
  });
  active = { ss, mode, windows: opts.windows, audioOffsetMs: opts.audioOffsetMs, off };
  if (!diagTap.active) return;
  diagTap.publish(sessionBody(active, 'start'));
  diagTap.publish({
    type: 'notes',
    songId: ss.chart.songId,
    notes: ss.chart.notes.map((n) => ({ timeMs: n.timeMs, pad: n.pad })),
  });
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
