// 플레이 로그 (공통 명세서 9-3) 의 0단계 로컬 버전. 텔레메트리는 telemetry.ts.
// 서버 업로드(ACCT-02)는 BE API가 나오면 붙인다. 지금은 localStorage에 최근 N건.
import type { Judgement, TimingWindows } from '@/domain/judgement';
import type { InputSourceKind, ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/pads';
import type { NoteState, SessionSnapshot } from './RhythmSession';

export interface LoggedHit {
  hitId: number;
  stickId: 0 | 1;
  pad: PadId | null;
  velocity: number;
  tHit: number;
  tRecv: number;
  tResolved: number;
  tAudio?: number;
  judgement?: Judgement;
  matchedNoteIndex?: number;
  deltaMs?: number;
  distanceDeg?: number;
}

export interface PlayLog {
  playId: string;
  songId: string;
  title: string;
  difficulty: string;
  mode: 'RHYTHM' | 'FREE' | 'SHEET';
  inputSource: InputSourceKind;
  startedAt: string;
  durationMs: number;
  timing: TimingWindows;
  calibrationId: string | null;
  hits: LoggedHit[];
  notes: { index: number; timeMs: number; pad: PadId; judgement: Judgement | null; deltaMs: number | null }[];
  summary: {
    score: number;
    maxScore: number;
    accuracy: number;
    maxCombo: number;
    counts: Record<Judgement, number>;
    strayHits: number;
  };
}

const KEY = 'ssaplash.playlogs';
const MAX = 20;

export function buildPlayLog(args: {
  snapshot: SessionSnapshot;
  notes: NoteState[];
  hits: LoggedHit[];
  chart: { songId: string; title: string; difficulty: string; durationMs: number };
  inputSource: InputSourceKind;
  timing: TimingWindows;
  startedAt: Date;
}): PlayLog {
  const { snapshot: s } = args;
  return {
    playId: `play-${Date.now().toString(36)}`,
    songId: args.chart.songId,
    title: args.chart.title,
    difficulty: args.chart.difficulty,
    mode: 'RHYTHM',
    inputSource: args.inputSource,
    startedAt: args.startedAt.toISOString(),
    durationMs: args.chart.durationMs,
    timing: args.timing,
    // 앵커 캘리브레이션을 없앴다. 프리셋 스냅샷은 ACCT-002에서 넣는다
    calibrationId: null,
    hits: args.hits,
    notes: args.notes.map((n) => ({
      index: n.index,
      timeMs: n.note.timeMs,
      pad: n.note.pad,
      judgement: n.judgement,
      deltaMs: n.deltaMs,
    })),
    summary: {
      score: s.score,
      maxScore: s.maxScore,
      accuracy: s.maxScore ? s.score / s.maxScore : 0,
      maxCombo: s.maxCombo,
      counts: s.counts,
      strayHits: s.strayHits,
    },
  };
}

export function savePlayLog(log: PlayLog): void {
  try {
    const list = loadPlayLogs();
    list.unshift(log);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 저장 실패는 플레이를 막지 않는다 */
  }
}

export function loadPlayLogs(): PlayLog[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlayLog[]) : [];
  } catch {
    return [];
  }
}

export function getPlayLog(playId: string): PlayLog | null {
  return loadPlayLogs().find((l) => l.playId === playId) ?? null;
}

export function toLoggedHit(h: ResolvedHit): LoggedHit {
  return {
    hitId: h.id,
    stickId: h.stickId,
    pad: h.pad,
    velocity: h.velocity,
    tHit: h.tHit,
    tRecv: h.tRecv,
    tResolved: h.tResolved,
    tAudio: h.tAudio,
    distanceDeg: h.distanceDeg,
  };
}
