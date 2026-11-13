// 관리자 공용 곡 관리(설계 CHART-001-관리자-공용곡-화면, Jira 262). BE 156 `/api/v1/admin/songs` 계약의 화면 타입과 입력 규칙.
// 권한 판단은 BE(@PreAuthorize ADMIN)가 한다. 여기 규칙은 요청 전에 막는 사전 검사다.
import { MAX_MIDI_BYTES } from '@/domain/song/midiUpload';
import { toSafeId } from '@/domain/song/songCatalog';

export const MAX_ADMIN_TITLE_LEN = 100;
export const MAX_ADMIN_ARTIST_LEN = 100;
export const MAX_LICENSE_LEN = 200;
/** 첫 마디 첫 박 시각 상한(ms). BE 카탈로그·등록 API와 같은 30분 */
export const MAX_OFFSET_MS = 1_800_000;
/** 반주 상한. BE 156 반주 업로드 50 MiB */
export const MAX_ACCOMPANIMENT_BYTES = 50 * 1024 * 1024;

export const ADMIN_LICENSE_EXAMPLE = '원곡 {아티스트}, 드럼 채보 AI 팀 제작, 비상업 프로젝트 내부 시연용';

/** `GET /api/v1/admin/songs` 항목 중 화면이 쓰는 값 */
export interface AdminSong {
  id: number;
  title: string;
  artist: string | null;
  license: string;
  status: string;
  hasAccompaniment: boolean;
  published: boolean;
  difficulties: string[];
}

/** 공용 곡 추가 창의 입력. offsetMs는 입력칸 문자열 그대로(빈 값 = 생략) */
export interface AdminSongDraft {
  file: File | null;
  title: string;
  artist: string;
  license: string;
  offsetMs: string;
  published: boolean;
  accompaniment: File | null;
}

export function adminSongFromDto(d: Record<string, unknown>): AdminSong {
  const artist = typeof d.artist === 'string' && d.artist.trim() !== '' ? d.artist : null;
  return {
    id: toSafeId(d.id),
    title: typeof d.title === 'string' ? d.title : '',
    artist,
    license: typeof d.license === 'string' ? d.license : '',
    status: typeof d.status === 'string' ? d.status : '',
    hasAccompaniment: d.hasAccompaniment === true,
    published: d.published !== false,
    difficulties: Array.isArray(d.difficulties) ? d.difficulties.filter((v): v is string => typeof v === 'string') : [],
  };
}

/** 빈 값이면 null(보내지 않음), 0~30분 정수면 그 값, 그 밖은 'invalid'. BE도 부호·공백·소수를 거절한다 */
export function parseOffsetMs(raw: string): number | null | 'invalid' {
  const v = raw.trim();
  if (v === '') return null;
  if (!/^[0-9]{1,7}$/.test(v)) return 'invalid';
  const n = Number(v);
  return n <= MAX_OFFSET_MS ? n : 'invalid';
}

export type AccompanimentPrecheckReason = 'EMPTY' | 'TYPE' | 'TOO_LARGE';
export type AccompanimentPrecheck = { ok: true } | { ok: false; reason: AccompanimentPrecheckReason };

const ACCOMPANIMENT_MIME = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/mpeg', 'audio/mp3']);

/** 확장자(.wav·.mp3) 또는 MIME으로 형식을 보고, 크기를 검사한다. 10분 상한·실제 형식은 BE(ffprobe)가 확인한다 */
export function precheckAccompaniment(file: { name: string; type: string; size: number }): AccompanimentPrecheck {
  if (file.size === 0) return { ok: false, reason: 'EMPTY' };
  const ext = /\.(wav|mp3)$/i.test(file.name);
  if (!ext && !ACCOMPANIMENT_MIME.has(file.type)) return { ok: false, reason: 'TYPE' };
  if (file.size > MAX_ACCOMPANIMENT_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  return { ok: true };
}

export const ACCOMPANIMENT_PRECHECK_TEXT: Record<AccompanimentPrecheckReason, string> = {
  EMPTY: '빈 파일입니다. 다른 파일을 골라 주세요.',
  TYPE: '반주는 WAV·MP3 파일만 올릴 수 있어요.',
  TOO_LARGE: '반주는 50 MiB 이하만 올릴 수 있어요. MP3로 바꿔 올려 주세요.',
};

export type AdminDraftReason = 'NO_FILE' | 'MIDI_EMPTY' | 'MIDI_TOO_LARGE' | 'TITLE' | 'ARTIST' | 'LICENSE' | 'OFFSET' | 'ACCOMPANIMENT';
export type AdminDraftCheck = { ok: true } | { ok: false; reason: AdminDraftReason };

export const ADMIN_DRAFT_TEXT: Record<AdminDraftReason, string> = {
  NO_FILE: 'MIDI 파일을 골라 주세요.',
  MIDI_EMPTY: '빈 MIDI 파일입니다. 다른 파일을 골라 주세요.',
  MIDI_TOO_LARGE: '1 MiB 이하 MIDI만 올릴 수 있어요.',
  TITLE: `곡 제목은 1~${MAX_ADMIN_TITLE_LEN}자로 적어 주세요.`,
  ARTIST: `아티스트는 ${MAX_ADMIN_ARTIST_LEN}자까지 적을 수 있어요.`,
  LICENSE: `출처·라이선스는 1~${MAX_LICENSE_LEN}자로 적어 주세요.`,
  OFFSET: `첫 박 시각은 0~${MAX_OFFSET_MS.toLocaleString('ko-KR')} 사이 정수(ms)로 적거나 비워 두세요.`,
  ACCOMPANIMENT: '반주 파일을 확인해 주세요(WAV·MP3, 50 MiB 이하).',
};

export function validateAdminDraft(d: AdminSongDraft): AdminDraftCheck {
  if (!d.file) return { ok: false, reason: 'NO_FILE' };
  if (d.file.size === 0) return { ok: false, reason: 'MIDI_EMPTY' };
  if (d.file.size > MAX_MIDI_BYTES) return { ok: false, reason: 'MIDI_TOO_LARGE' };
  const title = d.title.trim();
  if (title.length === 0 || title.length > MAX_ADMIN_TITLE_LEN) return { ok: false, reason: 'TITLE' };
  if (d.artist.trim().length > MAX_ADMIN_ARTIST_LEN) return { ok: false, reason: 'ARTIST' };
  const license = d.license.trim();
  if (license.length === 0 || license.length > MAX_LICENSE_LEN) return { ok: false, reason: 'LICENSE' };
  if (parseOffsetMs(d.offsetMs) === 'invalid') return { ok: false, reason: 'OFFSET' };
  if (d.accompaniment && !precheckAccompaniment(d.accompaniment).ok) return { ok: false, reason: 'ACCOMPANIMENT' };
  return { ok: true };
}

const ADMIN_ERROR_TEXT: Record<string, string> = {
  SONG_INVALID: '곡 정보(제목·라이선스·첫 박 시각)를 확인해 주세요.',
  MIDI_INVALID: 'MIDI 파일을 확인해 주세요.',
  MIDI_TOO_LARGE: '1 MiB 이하 MIDI만 올릴 수 있어요.',
  MIDI_NO_DRUM_NOTES: '드럼 채널(10)에 드럼 노트가 있는 MIDI를 올려 주세요.',
  MIDI_UNSUPPORTED: 'MIDI를 변환하지 못했어요. 파일이 손상됐거나, 첫 박 시각보다 앞선 노트가 있어요.',
  ACCOMPANIMENT_UNSUPPORTED: '반주는 10분 이하 WAV·MP3만 올릴 수 있어요.',
  ACCOMPANIMENT_UNAVAILABLE: '서버의 반주 저장소를 쓸 수 없어 올리지 못했어요. 저장소 설정을 확인한 뒤 다시 시도해 주세요(로컬 BE는 저장소가 없어 항상 실패해요).',
  SONG_NOT_FOUND: '곡을 찾지 못했어요. 목록을 새로 고쳐 주세요.',
  FORBIDDEN: '관리자 권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.',
  UNAUTHORIZED: '로그인이 필요합니다. 다시 로그인해 주세요.',
  NETWORK: '서버에 연결하지 못했어요. 결과를 확인하지 못했으니 목록을 확인한 뒤 다시 시도해 주세요.',
  HTTP_ERROR: '처리 결과를 확인하지 못했어요. 목록을 확인한 뒤 다시 시도해 주세요.',
};

export function adminErrorText(code: string): string {
  return ADMIN_ERROR_TEXT[code] ?? ADMIN_ERROR_TEXT.HTTP_ERROR;
}

/** 5xx여도 서버가 확실히 처리하지 않았다고 알려 주는 코드. 결과 미확인이 아니라 그 원인 문구를 쓴다 */
const DEFINITE_SERVER_CODES = new Set(['ACCOMPANIMENT_UNAVAILABLE']);

/** API 오류(상태·코드) → 화면 문구. 5xx는 원칙적으로 "결과 미확인", 코드가 확실한 실패를 말하면 그 문구 */
export function adminFailureText(status: number, code: string): string {
  if (status >= 500 && !DEFINITE_SERVER_CODES.has(code)) return adminErrorText('HTTP_ERROR');
  return adminErrorText(code);
}
