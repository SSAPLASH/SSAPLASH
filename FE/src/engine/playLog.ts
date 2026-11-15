// 플레이 로그 (공통 명세서 9-3) 의 로컬 버전. 텔레메트리는 telemetry.ts.
// localStorage에 계정별 최근 N건. 서버 업로드(ACCT-002 요약)는 runtime/playSync가 이 로그로 하고 상태를 upload에 적는다.
import type { HihatPedalCoverage } from '@/domain/kit/device/hihatPedalCoverage';
import type { TimingWindows } from '@/domain/play/judgement';
import type { InputSourceKind, ResolvedHit } from '@/domain/events';
import { normalizePadId } from '@/domain/kit/pads';
import type { LiveCoachEvent, LoggedHit, PlayLog } from '@/domain/play/playLog';
import type { NoteState, SessionSnapshot } from './RhythmSession';

/** 비로그인(인증 끔 개발 모드)의 저장 키. 계정 로그는 뒤에 `.u{userId}`를 붙여 따로 둔다 */
const BASE_KEY = 'ssaplash.playlogs';
const MAX = 20;

/** 지금 읽고 쓰는 로그의 주인. 로그인 상태는 app/authBootstrap이 넣어 준다(engine은 store를 모른다) */
let owner: number | null = null;

function storageKey(userId: number | null = owner): string {
  return userId === null ? BASE_KEY : `${BASE_KEY}.u${userId}`;
}

/** 로그를 읽고 쓸 계정을 바꾼다. null이면 비로그인 키 */
export function setPlayLogOwner(userId: number | null): void {
  owner = userId;
}

/** 한 계정의 로컬 로그를 모두 지운다(회원 탈퇴) */
export function clearPlayLogs(userId: number): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* 저장소를 못 쓰면 지울 것도 없다 */
  }
}

export function buildPlayLog(args: {
  snapshot: SessionSnapshot;
  notes: NoteState[];
  hits: LoggedHit[];
  chart: {
    songId: string;
    title: string;
    difficulty: string;
    durationMs: number;
    bpm: number;
    beatsPerBar: number;
    offsetMs?: number;
    sourceNoteCount?: number;
    /** 연습 속도로 늘린 채보면 배율과 원래 길이·빠르기·원점(domain/song/practiceRate.scaleChart가 넣는다) */
    playbackRate?: number;
    sourceTiming?: { durationMs: number; bpm: number; offsetMs: number };
  };
  inputSource: InputSourceKind;
  timing: TimingWindows;
  startedAt: Date;
  chartVersionId: number | null;
  songNumericId: number | null;
  chartId: number | null;
  presetId: string | null;
  /** 플레이 시작 시점의 연주 기록 활용 동의 */
  consent: boolean;
  /** 기본 'RHYTHM' */
  mode?: PlayLog['mode'];
  hihatPedalCoverage?: HihatPedalCoverage;
  /** MISS 판정 순번(noteIndex → seq). PlayRecorder.missSeqs */
  missSeqs?: ReadonlyMap<number, number>;
  audioOffsetMs?: number;
  /** 그 판에 적용된 킥 오프셋(ms). 넘기지 않으면 필드를 넣지 않는다 */
  kickOffsetMs?: number;
  /** 곡 시작 전 리드인 실제 길이(ms, 세션 preRollMs). 경과 시간 계산용 */
  countInMs?: number;
  endedAt?: Date;
  /** 실시간 코칭 기록. 넘기지 않으면 필드를 넣지 않는다 */
  liveCoachEvents?: LiveCoachEvent[];
}): PlayLog {
  const { snapshot: s } = args;
  // 연습 속도(늘린 채보)로 친 판: 위치 값은 원래 채보의 축(곡 시각)으로 되돌려 남긴다. 오차(deltaMs)·판정 폭·경과 시간은 실제 시간 그대로다
  const rate = args.chart.playbackRate ?? 1;
  const timing = args.chart.sourceTiming ?? { durationMs: args.chart.durationMs, bpm: args.chart.bpm, offsetMs: args.chart.offsetMs ?? 0 };
  const song = (ms: number) => (rate === 1 ? ms : ms * rate);
  return {
    playId: newPlayId(),
    songId: args.chart.songId,
    title: args.chart.title,
    difficulty: args.chart.difficulty,
    mode: args.mode ?? 'RHYTHM',
    inputSource: args.inputSource,
    startedAt: args.startedAt.toISOString(),
    durationMs: timing.durationMs,
    timing: args.timing,
    // 앵커 캘리브레이션을 없앴다. 프리셋 스냅샷은 ACCT-002에서 넣는다
    calibrationId: null,
    chartVersionId: args.chartVersionId,
    songNumericId: args.songNumericId,
    chartId: args.chartId,
    presetId: args.presetId,
    consent: args.consent,
    ...(rate !== 1 ? { playbackRate: rate } : {}),
    bpm: timing.bpm,
    beatsPerBar: args.chart.beatsPerBar,
    offsetMs: timing.offsetMs,
    hits: rate === 1 ? args.hits : args.hits.map((h) => (h.tSongMs === undefined ? h : { ...h, tSongMs: song(h.tSongMs) })),
    notes: args.notes.map((n) => ({
      index: n.index,
      timeMs: n.note.sourceTimeMs ?? n.note.timeMs,
      pad: n.note.pad,
      ...(n.note.pad === 'HIHAT' && n.note.hihatOpen === true ? { hihatOpen: true as const } : {}),
      judgement: n.judgement,
      deltaMs: n.deltaMs,
      noteId: n.note.noteId ?? null,
      seq: args.missSeqs?.get(n.index) ?? null,
    })),
    summary: {
      score: s.score,
      maxScore: s.maxScore,
      accuracy: s.maxScore ? s.score / s.maxScore : 0,
      maxCombo: s.maxCombo,
      counts: s.counts,
      strayHits: s.strayHits,
    },
    endedAt: (args.endedAt ?? new Date()).toISOString(),
    audioOffsetMs: args.audioOffsetMs ?? 0,
    ...(args.kickOffsetMs !== undefined ? { kickOffsetMs: args.kickOffsetMs } : {}),
    lastSongTimeMs: song(s.songTimeMs),
    elapsedActiveMs: Math.max(0, s.songTimeMs + (args.countInMs ?? 0)),
    sourceNoteCount: args.chart.sourceNoteCount ?? null,
    ...(args.hihatPedalCoverage ? { hihatPedalCoverage: args.hihatPedalCoverage } : {}),
    ...(args.liveCoachEvents
      ? { liveCoachEvents: rate === 1 ? args.liveCoachEvents : args.liveCoachEvents.map((e) => ({ ...e, tMs: song(e.tMs) })) }
      : {}),
  };
}

/** 서버 계약상 playId는 UUID. randomUUID가 없는 비보안 출처(LAN http)에서는 getRandomValues로 v4를 만든다 */
export function newPlayId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function savePlayLog(log: PlayLog): void {
  try {
    const list = loadPlayLogs();
    list.unshift(log);
    localStorage.setItem(storageKey(), JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 저장 실패는 플레이를 막지 않는다 */
  }
}

/** 저장된 로그 하나를 고친다(업로드 상태 갱신용). 없으면 아무것도 하지 않는다 */
export function updatePlayLog(playId: string, patch: (log: PlayLog) => PlayLog): PlayLog | null {
  try {
    const key = storageKey();
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const list = JSON.parse(raw) as PlayLog[];
    const i = list.findIndex((l) => l.playId === playId);
    if (i < 0) return null;
    list[i] = patch(list[i]);
    localStorage.setItem(key, JSON.stringify(list));
    return list[i];
  } catch {
    return null;
  }
}

export function loadPlayLogs(): PlayLog[] {
  try {
    const raw = localStorage.getItem(storageKey());
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
    ...(h.pad === 'HIHAT' ? { hihatClosed: h.hihatClosed ?? null } : {}),
    velocity: h.velocity,
    tHit: h.tHit,
    tRecv: h.tRecv,
    tResolved: h.tResolved,
    tAudio: h.tAudio,
    distanceDeg: h.distanceDeg,
    source: h.source,
    peakAccel: h.peakAccel,
    pitch: h.pose?.pitch,
    yaw: h.pose?.yaw,
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
