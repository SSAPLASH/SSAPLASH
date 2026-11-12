// 곡 작업실(음원 → 채보 생성) 도메인 (설계 3-5). 진행 타입·파일 사전 검사·곡 상태 매핑·오류 문구. 네트워크·저장소는 다루지 않는다.

export type JobStage = 'QUEUED' | 'SEPARATING' | 'TRANSCRIBING' | 'DONE' | 'FAILED';

/** 4칸 표시 순서. FAILED는 칸이 없다 */
export const JOB_STAGE_ORDER: JobStage[] = ['QUEUED', 'SEPARATING', 'TRANSCRIBING', 'DONE'];

export const STAGE_LABEL: Record<JobStage, string> = {
  QUEUED: '접수됨',
  SEPARATING: '드럼 분리',
  TRANSCRIBING: '채보 생성',
  DONE: '완료',
  FAILED: '실패',
};

export interface JobProgress {
  stage: JobStage;
  /** false면 곡 상태로 추정한 값("처리 중"으로 표시) */
  stageKnown: boolean;
  /** 서버가 준 0~100 정수, 없거나 잘못되면 null */
  percent: number | null;
  failReason: string | null;
}

/** localStorage에 보관하는 진행 중 작업. 다른 브라우저에서 복원(U2)하면 jobId를 모른다 */
export interface ActiveJob {
  jobId: number | null;
  songId: number;
  title: string;
  idempotencyKey: string;
  /** ISO 시각 */
  startedAt: string;
}

export const ACTIVE_JOB_KEY = 'ssaplash.chartJob.v1';

export interface UploadDraft {
  file: File;
  title: string;
  artist: string;
  idempotencyKey: string;
}

export const MAX_AUDIO_BYTES = 52_428_800;
export const MAX_TITLE_LEN = 100;

export type PrecheckReason = 'EXT' | 'SIZE' | 'EMPTY';
export type PrecheckResult = { ok: true } | { ok: false; reason: PrecheckReason };

const AUDIO_EXT = /\.(mp3|wav|m4a|opus|ogg)$/i;
// 브라우저마다 m4a는 audio/mp4·audio/x-m4a, opus는 audio/ogg·audio/opus로 넘긴다. .ogg의 Vorbis 거절은 BE 422로 처리
const AUDIO_MIME = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/ogg',
  'audio/opus',
];

/** 전송 전 검사. 순서는 빈 파일 → 크기 → 형식 */
export function precheckAudio(file: { name: string; size: number; type: string }): PrecheckResult {
  if (file.size <= 0) return { ok: false, reason: 'EMPTY' };
  if (file.size > MAX_AUDIO_BYTES) return { ok: false, reason: 'SIZE' };
  if (!AUDIO_EXT.test(file.name) && !AUDIO_MIME.includes(file.type.toLowerCase())) return { ok: false, reason: 'EXT' };
  return { ok: true };
}

export const PRECHECK_TEXT: Record<PrecheckReason, string> = {
  EXT: 'MP3·WAV·M4A·OPUS 파일만 올릴 수 있습니다.',
  SIZE: '파일이 너무 큽니다. 50 MiB 이하만 올릴 수 있습니다.',
  EMPTY: '빈 파일입니다. 다른 파일을 골라 주세요.',
};

/** 파일명에서 확장자·앞뒤 공백을 지우고 100자로 자른 기본 제목 */
export function defaultTitleFromFile(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, '').trim();
  const cut = Array.from(base).slice(0, MAX_TITLE_LEN).join('').trim();
  return cut === '' ? '제목 없음' : cut;
}

/** 서버 계약상 멱등 키는 UUID. randomUUID가 없는 비보안 출처에서는 getRandomValues로 v4를 만든다(engine/playLog의 newPlayId와 같은 방식, domain은 import하지 않으므로 복제) */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 곡 상태(폴링 응답)를 진행으로. PROCESSING의 세부 단계는 알 수 없다 */
export function songStatusToProgress(status: string): JobProgress {
  switch (status) {
    case 'PROCESSING':
      return { stage: 'SEPARATING', stageKnown: false, percent: null, failReason: null };
    case 'READY':
      return { stage: 'DONE', stageKnown: true, percent: null, failReason: null };
    case 'FAILED':
      return { stage: 'FAILED', stageKnown: true, percent: null, failReason: null };
    default:
      return { stage: 'QUEUED', stageKnown: true, percent: null, failReason: null };
  }
}

/** 작업 스냅샷 상태를 진행으로 변환한다. 알 수 없는 상태는 반영하지 않는다. */
export function jobSnapshotToProgress(snapshot: { status: string; progress: unknown; error: { code: string; message: string } | null }): JobProgress | null {
  if (!['QUEUED', 'SEPARATING', 'TRANSCRIBING', 'DONE', 'FAILED'].includes(snapshot.status)) return null;
  const n = snapshot.progress;
  const percent = typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
  return {
    stage: snapshot.status as JobStage,
    stageKnown: true,
    percent,
    failReason: snapshot.error?.message.trim() || null,
  };
}

export const UPLOAD_ERROR_TEXT: Record<string, string> = {
  AUDIO_INVALID: '제목 또는 파일이 올바르지 않습니다. 입력을 확인해 주세요.',
  AUDIO_UNSUPPORTED: '지원하지 않는 음원입니다. 10분 이하의 MP3·WAV·M4A·OPUS 파일을 올려 주세요.',
  AUDIO_TOO_LARGE: '파일이 너무 큽니다. 50 MiB 이하만 올릴 수 있습니다.',
  AUDIO_CONFLICT: '같은 요청이 다른 내용으로 이미 접수되어 있습니다. 파일을 다시 골라 올려 주세요.',
  AUDIO_BUSY: '이미 진행 중인 곡이 있습니다. 끝난 뒤에 다시 올려 주세요.',
  AUDIO_NOT_FOUND: '곡을 찾을 수 없습니다.',
  AUDIO_UNAVAILABLE: '지금은 업로드가 몰려 있습니다. 잠시 뒤에 다시 시도해 주세요.',
  NETWORK: '서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도해 주세요.',
  HTTP_ERROR: '서버가 응답하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.',
  UNAUTHORIZED: '로그인이 필요합니다. 다시 로그인해 주세요.',
};

/** BE detail이 있으면 그것, 없으면 표, 둘 다 없으면 기본 문구 */
/** detail이 BE 문장이 아니라 FE가 채운 원문(`HTTP 502 …`)인 코드. 표 문구를 쓴다 */
const FE_FILLED_DETAIL = new Set(['HTTP_ERROR', 'NETWORK']);

export function uploadErrorText(code: string, detail: string | null): string {
  if (!FE_FILLED_DETAIL.has(code) && detail !== null && detail.trim() !== '') return detail;
  return UPLOAD_ERROR_TEXT[code] ?? '음원을 올리지 못했습니다.';
}

/** 같은 키로 다시 보내도 되는 오류 */
export function isRetryableUploadError(code: string): boolean {
  return code === 'NETWORK' || code === 'HTTP_ERROR' || code === 'AUDIO_UNAVAILABLE';
}
