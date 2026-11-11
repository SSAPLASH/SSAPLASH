// 관리자 공용 곡 API (BE 156 `/api/v1/admin/songs`, ADMIN 전용, Jira 262). 권한이 없으면 BE가 403 FORBIDDEN을 준다.
import { adminSongFromDto, parseOffsetMs, type AdminSong, type AdminSongDraft } from './adminSong';
import { apiFetch } from '@/api/http';

const BASE = '/api/v1/admin/songs';
const PAGE_SIZE = 100;
/** 무한 반복 방지. 100곡 × 50쪽 = 5,000곡까지 */
const MAX_PAGES = 50;

/** 비공개 포함 공용 곡 전체(생성 내림차순). hasNext가 거짓이 될 때까지 읽는다 */
export async function listAllAdminSongs(signal?: AbortSignal): Promise<AdminSong[]> {
  const all: AdminSong[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await apiFetch<{ items?: Record<string, unknown>[]; hasNext?: boolean }>(`${BASE}?page=${page}&size=${PAGE_SIZE}`, { signal });
    all.push(...(body.items ?? []).map(adminSongFromDto));
    if (body.hasNext !== true) break;
  }
  return all;
}

/** `POST /midi` — 201 관리자 곡 상세. 멱등 키가 없어 자동 재시도하지 않는다. 검사는 호출 전에 domain/validateAdminDraft로 한다 */
export async function registerAdminSong(draft: AdminSongDraft, signal?: AbortSignal): Promise<AdminSong> {
  if (!draft.file) throw new Error('MIDI 파일이 없습니다');
  const form = new FormData();
  form.append('title', draft.title.trim());
  const artist = draft.artist.trim();
  if (artist !== '') form.append('artist', artist);
  form.append('license', draft.license.trim());
  if (!draft.published) form.append('published', 'false');
  const offset = parseOffsetMs(draft.offsetMs);
  if (typeof offset === 'number') form.append('offsetMs', String(offset));
  form.append('file', draft.file);
  const body = await apiFetch<Record<string, unknown>>(`${BASE}/midi`, { method: 'POST', body: form, signal });
  return adminSongFromDto(body);
}

/** `PUT /{id}/accompaniment` — WAV·MP3, 50 MiB·10분. 같은 곡에 다시 올리면 교체된다 */
export async function uploadAccompaniment(id: number, file: File, signal?: AbortSignal): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await apiFetch<unknown>(`${BASE}/${id}/accompaniment`, { method: 'PUT', body: form, signal });
}
