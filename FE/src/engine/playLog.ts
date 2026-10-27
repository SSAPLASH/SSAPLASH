// 플레이 로그 (공통 명세서 9-3) 의 0단계 로컬 버전. 텔레메트리는 telemetry.ts.
// 서버 업로드(ACCT-02)는 BE API가 나오면 붙인다. 지금은 localStorage에 최근 N건.
import type { Judgement, TimingWindows } from '@/domain/judgement';
import type { InputSourceKind, ResolvedHit } from '@/domain/events';
import { normalizePadId, type PadId } from '@/domain/pads';
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
  /** BE 채보 버전. 내장 채보는 null (이전 로그에는 필드가 없을 수 있다) */
  chartVersionId: number | null;
  /** BE 곡 id(숫자). 내장 채보는 null */
  songNumericId: number | null;
  /** BE 채보 id. "다시 하기" URL 복원용 */
  chartId: number | null;
  /** 연주 당시 적용 중이던 프리셋 */
  presetId: string | null;
  /** 채보 BPM·박자(마디 단위 피드백용). 이전 로그에는 없을 수 있다 */
  bpm: number;
  beatsPerBar: number;
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
  chart: { songId: string; title: string; difficulty: string; durationMs: number; bpm: number; beatsPerBar: number };
  inputSource: InputSourceKind;
  timing: TimingWindows;
  startedAt: Date;
  chartVersionId: number | null;
  songNumericId: number | null;
  chartId: number | null;
  presetId: string | null;
  /** 기본 'RHYTHM' */
  mode?: PlayLog['mode'];
}): PlayLog {
  const { snapshot: s } = args;
  return {
    playId: `play-${Date.now().toString(36)}`,
    songId: args.chart.songId,
    title: args.chart.title,
    difficulty: args.chart.difficulty,
    mode: args.mode ?? 'RHYTHM',
    inputSource: args.inputSource,
    startedAt: args.startedAt.toISOString(),
    durationMs: args.chart.durationMs,
    timing: args.timing,
    // 앵커 캘리브레이션을 없앴다. 프리셋 스냅샷은 ACCT-002에서 넣는다
    calibrationId: null,
    chartVersionId: args.chartVersionId,
    songNumericId: args.songNumericId,
    chartId: args.chartId,
    presetId: args.presetId,
    bpm: args.chart.bpm,
    beatsPerBar: args.chart.beatsPerBar,
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
    if (!raw) return [];
    // 옛 패드 이름(HI_TOM)은 읽을 때만 바꾼다. 저장 형식은 그대로 둔다
    return (JSON.parse(raw) as PlayLog[]).map((l) => ({
      ...l,
      notes: (l.notes ?? []).flatMap((n) => {
        const pad = normalizePadId(n.pad);
        return pad ? [{ ...n, pad }] : [];
      }),
      hits: (l.hits ?? []).map((h) => ({ ...h, pad: h.pad == null ? null : normalizePadId(h.pad) })),
    }));
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

/** 같은 곡의 가장 최근 악보 연주 로그(없으면 null). logs는 최신순(loadPlayLogs) */
export function latestSheetLog(logs: PlayLog[], key: { songNumericId?: number | null; songId?: string }): PlayLog | null {
  return (
    logs.find(
      (l) =>
        l.mode === 'SHEET' &&
        ((key.songNumericId != null && l.songNumericId === key.songNumericId) ||
          (key.songNumericId == null && key.songId !== undefined && l.songId === key.songId)),
    ) ?? null
  );
}

/** 정확도(0~1) → "84.5%" */
export function formatAccuracy(a: number): string {
  return `${(a * 100).toFixed(1)}%`;
}
