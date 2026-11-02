// 플레이 로그 (공통 명세서 9-3) 의 로컬 버전. 텔레메트리는 telemetry.ts.
// localStorage에 계정별 최근 N건. 서버 업로드(ACCT-002 요약)는 app/playSync가 이 로그로 하고 상태를 upload에 적는다.
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
  /** 판정 처리 순번(업로드 hits.seq). 이전 로그에는 없다 */
  seq?: number;
  /** 판정에 쓴 곡 시각(ms, 오디오 오프셋 반영). 이전 로그에는 없다 */
  tSongMs?: number;
  /** 이 타격의 입력 경로(스틱 세션에 섞인 키보드 킥 구분). 이전 로그에는 없다 */
  source?: InputSourceKind;
  /** 센서 수집값. 키보드 타격은 업로드에서 null로 보낸다 */
  peakAccel?: number;
  pitch?: number;
  yaw?: number;
}

export interface LogNote {
  index: number;
  timeMs: number;
  pad: PadId;
  judgement: Judgement | null;
  deltaMs: number | null;
  /** BE 채보 노트 id. 내장 채보·이전 로그는 없다 */
  noteId?: string | null;
  /** MISS 판정 처리 순번. 그 밖은 null(타격 쪽 seq를 쓴다) */
  seq?: number | null;
}

/** 서버 업로드 상태 (설계 COACH-002 D2). 실패해도 로그는 지우지 않고 같은 playId로 재전송한다 */
export interface PlayUploadState {
  status: 'UPLOADING' | 'DONE' | 'FAILED' | 'SKIPPED';
  /** SKIPPED 사유 또는 실패 오류 코드 */
  reason: string | null;
  /** FAILED일 때 같은 본문으로 다시 보내도 되는지 */
  retryable: boolean;
  attempts: number;
  /** 처음 조립한 업로드 본문. 재전송은 이것을 그대로 보낸다. DONE이면 지운다 */
  body?: unknown;
  updatedAt: string;
}

/** 실시간 코칭이 띄운 문구 기록. coach 모듈의 로그 항목과 모양이 같다(engine은 coach를 import하지 않는다) */
export interface LiveCoachEvent {
  tMs: number;
  tag: string;
  text: string;
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
  /** 채보 격자 원점(1마디 1박, ms). 결과 화면 약점 마디·미니 악보가 쓴다. 이전 로그에는 없고 0으로 읽는다 */
  offsetMs?: number;
  hits: LoggedHit[];
  notes: LogNote[];
  summary: {
    score: number;
    maxScore: number;
    accuracy: number;
    maxCombo: number;
    counts: Record<Judgement, number>;
    strayHits: number;
  };
  /** 아래는 업로드용. 이전 로그에는 없다 */
  endedAt?: string;
  /** 판정에 적용한 오디오 출력 오프셋(ms) */
  audioOffsetMs?: number;
  /** 종료 시 곡 시각, 일시정지를 뺀 카운트인 포함 경과(ms) */
  lastSongTimeMs?: number;
  elapsedActiveMs?: number;
  /** BE 채보 전체 노트 수. notes.length와 다르면 변환에서 버린 노트가 있다 */
  sourceNoteCount?: number | null;
  /** 실시간 코칭 기록. 이전 로그에는 없다(업로드 본문은 빈 배열) */
  liveCoachEvents?: LiveCoachEvent[];
  upload?: PlayUploadState;
}

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
  };
  inputSource: InputSourceKind;
  timing: TimingWindows;
  startedAt: Date;
  chartVersionId: number | null;
  songNumericId: number | null;
  chartId: number | null;
  presetId: string | null;
  /** 기본 'RHYTHM' */
  mode?: PlayLog['mode'];
  /** MISS 판정 순번(noteIndex → seq). PlayRecorder.missSeqs */
  missSeqs?: ReadonlyMap<number, number>;
  audioOffsetMs?: number;
  /** 카운트인 길이(ms). 경과 시간 계산용 */
  countInMs?: number;
  endedAt?: Date;
  /** 실시간 코칭 기록. 넘기지 않으면 필드를 넣지 않는다 */
  liveCoachEvents?: LiveCoachEvent[];
}): PlayLog {
  const { snapshot: s } = args;
  return {
    playId: newPlayId(),
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
    offsetMs: args.chart.offsetMs ?? 0,
    hits: args.hits,
    notes: args.notes.map((n) => ({
      index: n.index,
      timeMs: n.note.timeMs,
      pad: n.note.pad,
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
    lastSongTimeMs: s.songTimeMs,
    elapsedActiveMs: Math.max(0, s.songTimeMs + (args.countInMs ?? 0)),
    sourceNoteCount: args.chart.sourceNoteCount ?? null,
    ...(args.liveCoachEvents ? { liveCoachEvents: args.liveCoachEvents } : {}),
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
