// 연주 녹음 도메인 (설계 REC-001). 타입·변환·본문 조립·제목 규칙만 둔다. 순수 함수라 네트워크·스토어·시계에 접근하지 않는다(시각은 인자로 받는다).
import { isSensorSource, type ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import type { LoggedHit } from './playLog';

/** 녹음 한 건의 타격 수 상한(BE 계약) */
export const MAX_RECORDING_HITS = 50_000;
/** 녹음 길이 상한(ms, 2시간) */
export const MAX_RECORDING_DURATION_MS = 7_200_000;
/** 제목 최대 길이(코드 포인트 기준, BE와 같음) */
export const MAX_RECORDING_TITLE_LENGTH = 100;

export type RecordingMode = 'FREE' | 'RHYTHM' | 'SHEET' | 'TEMPO';
export type RecordingInputSource = 'KEYBOARD' | 'STICK';
export type RecordingSort = 'NEWEST' | 'OLDEST';

/** 녹음 타격. 키보드 타격은 `stickId` 키 자체가 없다(null·undefined 대입 금지, 계약상 null이면 400) */
export interface RecordingHit {
  tMs: number;
  pad: PadId;
  velocity: number;
  stickId?: 0 | 1;
}

/** `POST /api/v1/recordings` 본문 (저장 계약) */
export interface RecordingBody {
  schemaVersion: 1;
  clientKey: string;
  title: string;
  mode: RecordingMode;
  inputSource: RecordingInputSource;
  /** 플레이 로그 업로드가 DONE일 때만. 없으면 키 생략 */
  playId?: string;
  startedAt: string;
  durationMs: number;
  hits: RecordingHit[];
}

export interface RecordingSong {
  songId: number;
  title: string;
  difficulty: string;
}

export interface RecordingSummary {
  id: number;
  clientKey: string;
  title: string;
  mode: RecordingMode;
  inputSource: RecordingInputSource;
  playId: string | null;
  hitCount: number;
  durationMs: number;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
  song: RecordingSong | null;
}

/** 상세의 timing. MIDI 내보내기(288)용이라 287에서는 타입만 둔다 */
export interface RecordingTiming {
  songId: number;
  chartVersionId: number;
  bpm: number;
  offsetMs: number;
  timeSignature: string;
  ppq: number;
  tempoMap: { tick: number; bpm: number }[];
  timeSignatureMap: { tick: number; numerator: number; denominator: number }[];
}

export interface RecordingDetail extends RecordingSummary {
  timing: RecordingTiming | null;
  hits: RecordingHit[];
}

const codePoints = (s: string): string[] => [...s];
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * 녹음에 스틱 정보를 남길 센서 타격인지(스틱·페달 모두 true, stickId 유무와 무관). 공용 판정(키보드·톡 치기·화면 터치·source 없음 제외)에
 * 더해 포인터(마우스 스틱 흉내)도 뺀다
 */
export function isRecordedSensor(source: string | undefined): boolean {
  return isSensorSource(source) && source !== 'pointer';
}

/** 입력 경로 결정. 센서 타격이 하나라도 있으면 STICK (U7) */
export function decideInputSource(hasSensor: boolean): RecordingInputSource {
  return hasSensor ? 'STICK' : 'KEYBOARD';
}

/**
 * 플레이 로그 타격 → 녹음 타격 (설계 3-1).
 * tSongMs가 없거나 0 미만이거나 pad가 null이면 뺀다. tMs 오름차순 안정 정렬, 50,000개 초과면 앞에서 자른다.
 * 센서 타격(키보드·포인터·화면 터치·source 없음 제외)만 stickId를 넣고, 하나라도 있으면 hasSensor.
 */
export function hitsFromPlayLog(hits: LoggedHit[]): { hits: RecordingHit[]; hasSensor: boolean } {
  const out: RecordingHit[] = [];
  let hasSensor = false;
  for (const h of hits) {
    if (h.tSongMs === undefined || !Number.isFinite(h.tSongMs) || h.tSongMs < 0 || h.pad === null) continue;
    const hit: RecordingHit = { tMs: h.tSongMs, pad: h.pad, velocity: clamp(Math.round(h.velocity), 0, 127) };
    if (isRecordedSensor(h.source)) {
      if (h.stickId !== null) hit.stickId = h.stickId;
      hasSensor = true;
    }
    out.push(hit);
  }
  // Array.prototype.sort는 안정 정렬이다
  out.sort((a, b) => a.tMs - b.tMs);
  return { hits: out.slice(0, MAX_RECORDING_HITS), hasSensor };
}

/**
 * 자유 연습 입력 → 녹음 타격. pad가 null이면 null, tMs = tHit − 녹음 시작(0 미만이면 0).
 * 센서 입력이면 stickId를 넣고 키보드·포인터(마우스 스틱 흉내)·화면 터치면 키를 생략한다.
 */
export function hitFromFreeInput(hit: ResolvedHit, startPerfMs: number): RecordingHit | null {
  if (hit.pad === null) return null;
  const out: RecordingHit = {
    tMs: Math.max(0, hit.tHit - startPerfMs),
    pad: hit.pad,
    velocity: clamp(Math.round(hit.velocity), 0, 127),
  };
  // 손 없는 타격(페달, stickId null)은 키를 생략한다
  if (isRecordedSensor(hit.source) && hit.stickId !== null) out.stickId = hit.stickId;
  return out;
}

/** 곡 없이 저장한 녹음의 기본 이름 */
export const FREE_RECORDING_NAME = '자유 연습';

/** 기본 제목 끝에 붙는 녹음 시각: ` · {M월 D일 HH:mm}`. 로컬 24시간제 */
export function recordingTitleSuffix(startedAt: Date): string {
  const hh = String(startedAt.getHours()).padStart(2, '0');
  const mm = String(startedAt.getMinutes()).padStart(2, '0');
  return ` · ${startedAt.getMonth() + 1}월 ${startedAt.getDate()}일 ${hh}:${mm}`;
}

/** 기본 제목: `{곡 제목} · {M월 D일 HH:mm}`. 곡이 없으면 "자유 연습". 로컬 24시간제. 100자 초과면 곡 제목 쪽을 줄인다 */
export function defaultRecordingTitle(songTitle: string | null, startedAt: Date): string {
  const suffix = recordingTitleSuffix(startedAt);
  const name = songTitle === null || songTitle.trim() === '' ? FREE_RECORDING_NAME : songTitle.trim();
  const room = MAX_RECORDING_TITLE_LENGTH - codePoints(suffix).length;
  const chars = codePoints(name);
  if (chars.length <= room) return name + suffix;
  // 말줄임표 한 글자 자리를 남기고 자른다
  return chars.slice(0, Math.max(0, room - 1)).join('') + '…' + suffix;
}

/** 제목 정리: 앞뒤 공백 제거, 비면 fallback, 100 코드 포인트 초과면 자른다 */
export function normalizeRecordingTitle(input: string, fallback: string): string {
  const t = input.trim();
  if (t === '') return fallback;
  const chars = codePoints(t);
  return chars.length > MAX_RECORDING_TITLE_LENGTH ? chars.slice(0, MAX_RECORDING_TITLE_LENGTH).join('') : t;
}

/**
 * 저장 본문 조립 (설계 3-2). playId가 없으면 키를 생략한다.
 * `baseDurationMs`는 호출자가 정한 기본 길이(리듬·악보는 채보 길이, 자유는 정지 − 시작). 마지막 tMs가 더 크면 그쪽으로 보정하고 정수로 올림한다.
 */
export function buildRecordingBody(args: {
  clientKey: string;
  title: string;
  mode: RecordingMode;
  hasSensor: boolean;
  playId?: string | null;
  startedAt: Date;
  baseDurationMs: number;
  hits: RecordingHit[];
}): RecordingBody {
  const lastT = args.hits.reduce((m, h) => Math.max(m, h.tMs), 0);
  const body: RecordingBody = {
    schemaVersion: 1,
    clientKey: args.clientKey,
    title: args.title,
    mode: args.mode,
    inputSource: decideInputSource(args.hasSensor),
    startedAt: args.startedAt.toISOString(),
    durationMs: Math.ceil(Math.max(args.baseDurationMs, lastT)),
    hits: args.hits,
  };
  if (args.playId) body.playId = args.playId;
  return body;
}
