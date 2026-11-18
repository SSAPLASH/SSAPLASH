// 플레이 로그 → 요약 업로드 본문 (ACCT-002 v1, 설계 COACH-002 3-2). 순수 함수, 네트워크 없음.
// 서버는 같은 규칙으로 다시 계산해 모순이면 400을 낸다(PlayUploadValidator). 여기서 계산식을 서버와 맞춘다.
import type { LiveCoachEvent, LoggedHit, PlayLog } from './playLog';
import { JUDGEMENT_SCORE, SCORE_RULE, type Judgement } from './judgement';
import type { PadId } from '@/domain/kit/pads';
import { isSensorSource } from '@/domain/events';

export type UploadInputSource = 'KEYBOARD' | 'STICK';

export interface UploadHit {
  seq: number;
  tMs: number;
  stickId: 0 | 1 | null;
  pad: PadId;
  baselinePad: null;
  predictedPad: null;
  velocity: number | null;
  peakAccel: number | null;
  pitch: number | null;
  yaw: number | null;
  judgement: Judgement | null;
  matchedNoteId: string | null;
  deltaMs: number | null;
}

export interface PlayUploadBody {
  schemaVersion: 1;
  playId: string;
  mode: 'RHYTHM' | 'SHEET';
  inputSource: UploadInputSource;
  songId: number;
  chartVersionId: number;
  kitPresetId: number | null;
  kitPresetSnapshot: null;
  calibration: { audioOffsetMs: number; pads: null };
  judgementContext: {
    schemaVersion: 1;
    judgementVersion: typeof SCORE_RULE;
    timingWindows: { perfectMs: number; goodMs: number };
    /** 연습 속도 배율(0.5~1). 1이 아니면 tMs는 곡 시각, deltaMs·timingWindows는 실제 시간이다(mail MODE-003_연습-속도-기록-처리) */
    playbackRate: number;
    padMapping: Record<string, never>;
  };
  startedAt: string;
  endedAt: string;
  consent: boolean;
  summary: {
    score: number;
    /** 백분율 0~100, 소수 둘째 자리 HALF_UP */
    accuracy: number;
    maxCombo: number;
    judgementCounts: { perfect: number; good: number; miss: number };
  };
  hits: UploadHit[];
  liveCoachEvents: LiveCoachEvent[];
  clientMeta: {
    endReason: 'COMPLETED';
    lastSongTimeMs: number;
    elapsedActiveMs: number;
    appVersion: string | null;
    firmwareVersion: null;
  } | null;
}

/** 업로드하지 않는 이유. 결과 화면 버튼 안내에 쓴다 */
export type UploadSkipReason =
  | 'LEGACY_LOG' // 이전 형식 로그(UUID·순번 없음)
  | 'FREE_MODE' // 자유 연주 — 이번 범위 밖
  | 'BUILTIN_CHART' // 서버에 없는 내장 채보
  | 'CHART_MISMATCH' // 변환에서 버린 노트가 있거나 noteId가 없음 — 정확도 분모가 서버와 다르다
  | 'TOO_LARGE'; // hits 50,000행 초과

export type BuildUploadResult = { ok: true; body: PlayUploadBody } | { ok: false; reason: UploadSkipReason };

export interface UploadContext {
  /** 플레이 시작 시점의 연주 기록 활용 동의(로그 consent). 없으면 false */
  consent: boolean;
  appVersion: string | null;
}

const MAX_HITS = 50_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID playId인지. 이전 로그(`play-…`)는 서버에 올리지 않는다 */
export function isServerPlayId(playId: string): boolean {
  return UUID_RE.test(playId);
}
/** 실제 스틱 센서. 그 밖(키보드·포인터)은 KEYBOARD로 보낸다 (설계 U3) */
const STICK_SOURCES = new Set(['ble', 'webserial', 'websocket']);

export function uploadInputSource(source: string): UploadInputSource {
  return STICK_SOURCES.has(source) ? 'STICK' : 'KEYBOARD';
}

/** score / noteCount 백분율을 소수 둘째 자리 HALF_UP으로. 부동소수 오차 없이 정수로 계산한다 */
export function accuracyPercent(score: number, noteCount: number): number {
  if (noteCount <= 0) return 0;
  const hundredths = Math.floor((score * 200 + noteCount) / (2 * noteCount));
  return hundredths / 100;
}

const velocityOf = (v: number) => Math.min(127, Math.max(0, Math.round(v)));
const finiteOrNull = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : null);

export function buildUploadBody(log: PlayLog, ctx: UploadContext): BuildUploadResult {
  if (log.mode === 'FREE') return { ok: false, reason: 'FREE_MODE' };
  if (!isServerPlayId(log.playId) || log.hits.some((h) => h.seq === undefined)) return { ok: false, reason: 'LEGACY_LOG' };
  if (log.songNumericId == null || log.chartVersionId == null) return { ok: false, reason: 'BUILTIN_CHART' };
  const noteCount = log.sourceNoteCount ?? log.notes.length;
  if (noteCount !== log.notes.length || log.notes.some((n) => !n.noteId)) return { ok: false, reason: 'CHART_MISMATCH' };

  // 연습 속도: 로그의 위치 값은 이미 곡 시각이다. 판정 타격의 tMs만 「노트 시각 + 실제 오차 × 배율」로 만들어
  // 서버 검사식 (tMs − note.timeMs) / playbackRate = deltaMs에 맞춘다
  const rate = log.playbackRate ?? 1;
  const inputSource = uploadInputSource(log.inputSource);
  const sensorHit = (h: LoggedHit) => inputSource === 'STICK' && isSensorSource(h.source);

  const rows: Omit<UploadHit, 'seq'>[] = [];
  const order: number[] = [];
  for (const h of log.hits) {
    // 패드 없는 타격(앵커 밖)은 서버 계약상 보낼 수 없다
    if (h.pad === null || h.seq === undefined) continue;
    const sensor = sensorHit(h);
    const note = h.judgement && h.matchedNoteIndex !== undefined ? log.notes[h.matchedNoteIndex] : undefined;
    const judged = note !== undefined && h.deltaMs !== undefined;
    rows.push({
      // 판정 타격은 서버 검사식(deltaMs = (tMs − note.timeMs) / playbackRate)과 같은 값이 되도록 노트 시각에서 되돌린다
      tMs: judged ? note.timeMs + h.deltaMs! * rate : (h.tSongMs ?? 0),
      stickId: sensor ? h.stickId : null,
      pad: h.pad,
      baselinePad: null,
      predictedPad: null,
      velocity: velocityOf(h.velocity),
      peakAccel: sensor ? finiteOrNull(h.peakAccel) : null,
      pitch: sensor ? finiteOrNull(h.pitch) : null,
      yaw: sensor ? finiteOrNull(h.yaw) : null,
      judgement: judged ? h.judgement! : null,
      matchedNoteId: judged ? note.noteId! : null,
      deltaMs: judged ? h.deltaMs! : null,
    });
    order.push(h.seq);
  }
  for (const n of log.notes) {
    if (n.judgement !== 'MISS' || n.seq == null) continue;
    rows.push({
      tMs: n.timeMs,
      stickId: null,
      pad: n.pad,
      baselinePad: null,
      predictedPad: null,
      velocity: null,
      peakAccel: null,
      pitch: null,
      yaw: null,
      judgement: 'MISS',
      matchedNoteId: n.noteId!,
      deltaMs: null,
    });
    order.push(n.seq);
  }
  if (rows.length > MAX_HITS) return { ok: false, reason: 'TOO_LARGE' };

  // 처리 순서대로 정렬하고 0부터 다시 번호 매긴다(빠진 타격의 빈 번호 제거)
  const idx = rows.map((_, i) => i).sort((a, b) => order[a] - order[b]);
  const hits: UploadHit[] = idx.map((i, seq) => ({ seq, ...rows[i] }));

  // 집계도 서버와 같은 방식(seq 순서)으로 다시 낸다. 로컬 summary와 다르면 경고만 남긴다
  const counts = { perfect: 0, good: 0, miss: 0 };
  let combo = 0;
  let maxCombo = 0;
  for (const h of hits) {
    if (h.judgement === null) continue;
    if (h.judgement === 'MISS') {
      counts.miss += 1;
      combo = 0;
    } else {
      if (h.judgement === 'PERFECT') counts.perfect += 1;
      else counts.good += 1;
      maxCombo = Math.max(maxCombo, ++combo);
    }
  }
  const score = counts.perfect * JUDGEMENT_SCORE.PERFECT + counts.good * JUDGEMENT_SCORE.GOOD;
  if (score !== log.summary.score || maxCombo !== log.summary.maxCombo) {
    console.warn('업로드 집계가 로컬 결과와 다릅니다', { score, maxCombo, local: log.summary });
  }

  const endedAt = log.endedAt ?? new Date(Date.parse(log.startedAt) + log.durationMs).toISOString();
  const presetId = log.presetId !== null && /^\d+$/.test(log.presetId) ? Number(log.presetId) : null;

  return {
    ok: true,
    body: {
      schemaVersion: 1,
      playId: log.playId,
      mode: log.mode,
      inputSource,
      songId: log.songNumericId,
      chartVersionId: log.chartVersionId,
      kitPresetId: presetId,
      kitPresetSnapshot: null,
      calibration: { audioOffsetMs: log.audioOffsetMs ?? 0, pads: null },
      judgementContext: {
        schemaVersion: 1,
        judgementVersion: SCORE_RULE,
        timingWindows: { perfectMs: log.timing.perfectMs, goodMs: log.timing.goodMs },
        playbackRate: rate,
        padMapping: {},
      },
      startedAt: log.startedAt,
      endedAt: endedAt < log.startedAt ? log.startedAt : endedAt,
      consent: ctx.consent,
      summary: { score, accuracy: accuracyPercent(score, noteCount), maxCombo, judgementCounts: counts },
      hits,
      liveCoachEvents: log.liveCoachEvents ?? [],
      clientMeta:
        log.lastSongTimeMs !== undefined && log.elapsedActiveMs !== undefined
          ? {
              endReason: 'COMPLETED',
              lastSongTimeMs: log.lastSongTimeMs,
              elapsedActiveMs: log.elapsedActiveMs,
              appVersion: ctx.appVersion,
              firmwareVersion: null,
            }
          : null,
    },
  };
}
