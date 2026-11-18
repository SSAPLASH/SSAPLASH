// 곡 API (BE 96, 설계 3-1). 응답 숫자 id·bpm 변환까지만 하고 Chart 변환은 domain/song/chartMapping이 맡는다.
import type { UploadDraft } from '@/domain/song/chartJob';
import type { MidiDraft } from '@/domain/song/midiUpload';
import { availabilityFromFailure, type SongAvailability } from '@/domain/song/songAvailability';
import type { SongMetaPatch } from '@/domain/song/songEdit';
import { songDetailFromDto, songFromDto, toSafeId, type SongDetail, type SongLevel, type SongPage, type SongScope, type SongSummary } from '@/domain/song/songCatalog';
import { ApiError } from '@/api/error';
import { apiFetch } from '@/api/http';

export interface ListSongsParams {
  source: SongScope;
  q?: string;
  page?: number;
  size?: number;
  /** 곡 난이도 서버 필터. 없으면 전체 */
  songLevel?: SongLevel;
  /** true면 READY이면서 곡 난이도가 있는 곡만(곡 선택·추천). false·생략이면 쿼리를 보내지 않는다 */
  playableOnly?: boolean;
  /** true면 반주가 있거나 만드는 중인 곡만(자유 연습 반주 선택 창, 설계 MODE-002 3-2). false·생략이면 쿼리를 보내지 않는다 */
  withAccompaniment?: boolean;
}

/** `GET /api/v1/songs` */
export async function listSongs(params: ListSongsParams, signal?: AbortSignal): Promise<SongPage> {
  const qs = new URLSearchParams({ source: params.source });
  const q = params.q?.trim();
  if (q) qs.set('q', q);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.size !== undefined) qs.set('size', String(params.size));
  if (params.songLevel) qs.set('songLevel', params.songLevel);
  if (params.playableOnly) qs.set('playableOnly', 'true');
  if (params.withAccompaniment) qs.set('withAccompaniment', 'true');
  const body = await apiFetch<{ items?: Record<string, unknown>[]; hasNext?: boolean }>(`/api/v1/songs?${qs}`, { signal });
  return { items: (body.items ?? []).map(songFromDto), hasNext: body.hasNext === true };
}

/** 전체 목록을 읽을 때 한 번에 받는 곡 수. BE `@Max(100)` */
export const SONG_LIST_PAGE_SIZE = 100;
/** 무한 반복 방지. 100곡 × 50쪽 = 5,000곡까지 */
export const SONG_LIST_MAX_PAGES = 50;

export interface ListAllSongsOptions {
  signal?: AbortSignal;
  /** 참이면 다음 페이지를 읽지 않고 지금까지 모은 목록을 돌려준다(더 새 요청이 생긴 경우) */
  isStale?: () => boolean;
}

/** 같은 조건으로 hasNext가 거짓이 될 때까지 이어 읽어 하나로 합친다(서버 순서 유지) */
export async function listAllSongs(
  params: Omit<ListSongsParams, 'page' | 'size'>,
  opts: ListAllSongsOptions = {},
): Promise<SongSummary[]> {
  const all: SongSummary[] = [];
  for (let page = 0; page < SONG_LIST_MAX_PAGES; page++) {
    const res = await listSongs({ ...params, page, size: SONG_LIST_PAGE_SIZE }, opts.signal);
    all.push(...res.items);
    if (!res.hasNext || opts.isStale?.()) break;
  }
  return all;
}

/** 곡 단위 반주 URL. 반주가 없으면 url·expiresAt 모두 null */
export interface SongAccompaniment {
  url: string | null;
  expiresAt: string | null;
}

/** `GET /api/v1/songs/{songId}/accompaniment` (BE 265). 실패는 ApiError 그대로 던진다(문구 변환은 호출자) */
export async function getSongAccompaniment(songId: number, signal?: AbortSignal): Promise<SongAccompaniment> {
  const body = await apiFetch<{ accompanimentUrl?: unknown; expiresAt?: unknown }>(`/api/v1/songs/${songId}/accompaniment`, { signal });
  const url = typeof body.accompanimentUrl === 'string' && body.accompanimentUrl !== '' ? body.accompanimentUrl : null;
  return { url, expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null };
}

/** 실패한 MIDI 반주 생성을 다시 접수한다. 성공 응답은 본문 없는 202다. */
export async function retryMidiAccompaniment(id: number, signal?: AbortSignal): Promise<void> {
  await apiFetch(`/api/v1/songs/${id}/accompaniment/retry`, { method: 'POST', signal });
}

/** `GET /api/v1/songs/{id}` — 난이도별 채보 요약 포함 */
export async function getSong(id: number, signal?: AbortSignal): Promise<SongDetail> {
  const body = await apiFetch<Record<string, unknown>>(`/api/v1/songs/${id}`, { signal });
  return songDetailFromDto(body);
}

/** 연주 기록의 곡이 아직 있는지(U7). 상세가 오면 available, 404 SONG_NOT_FOUND면 deleted, 그 밖의 실패는 unknown. 취소는 그대로 던진다 */
export async function checkSongAvailability(id: number, signal?: AbortSignal): Promise<SongAvailability> {
  try {
    await getSong(id, signal);
    return 'available';
  } catch (e) {
    if (signal?.aborted) throw e;
    return availabilityFromFailure(e instanceof ApiError ? e : null);
  }
}

/** 음원 접수 202 응답 */
export interface AudioUploadAccepted {
  jobId: number;
  songId: number;
  status: string;
}

/** `POST /api/v1/songs/audio` — multipart. 같은 `Idempotency-Key`면 같은 내용 재전송도 202 (설계 3-1) */
export async function uploadAudio(draft: UploadDraft, signal?: AbortSignal): Promise<AudioUploadAccepted> {
  const form = new FormData();
  form.append('title', draft.title);
  if (draft.artist.trim() !== '') form.append('artist', draft.artist);
  form.append('file', draft.file);
  const body = await apiFetch<Record<string, unknown>>('/api/v1/songs/audio', {
    method: 'POST',
    body: form,
    headers: { 'Idempotency-Key': draft.idempotencyKey },
    signal,
  });
  return {
    jobId: toSafeId(body.jobId, 'jobId'),
    songId: toSafeId(body.songId, 'songId'),
    status: typeof body.status === 'string' ? body.status : 'QUEUED',
  };
}

/** `POST /api/v1/songs/midi` — multipart, 201 곡 상세. 멱등 키 없음: 자동 재시도하지 않는다 (설계 CHART-002 3-3) */
export async function uploadMidi(draft: MidiDraft, signal?: AbortSignal): Promise<SongDetail> {
  const form = new FormData();
  form.append('title', draft.title);
  if (draft.artist.trim() !== '') form.append('artist', draft.artist.trim());
  form.append('file', draft.file);
  const body = await apiFetch<Record<string, unknown>>('/api/v1/songs/midi', { method: 'POST', body: form, signal });
  return songDetailFromDto(body);
}

/** `POST /api/v1/songs/musicxml` — MIDI와 같은 multipart, 201 곡 상세(`source=MUSICXML`). AI 변환은 BE가 동기로 한다 (293) */
export async function uploadMusicXml(draft: MidiDraft, signal?: AbortSignal): Promise<SongDetail> {
  const form = new FormData();
  form.append('title', draft.title.trim());
  if (draft.artist.trim() !== '') form.append('artist', draft.artist.trim());
  form.append('file', draft.file);
  const body = await apiFetch<Record<string, unknown>>('/api/v1/songs/musicxml', { method: 'POST', body: form, signal });
  return songDetailFromDto(body);
}

/** `PATCH /api/v1/songs/{id}` — 바뀐 필드만 JSON으로 보낸다. 아티스트 `""`는 비움 (설계 CHART-001 3-1, 제안 API) */
export async function updateSongMeta(id: number, patch: SongMetaPatch, signal?: AbortSignal): Promise<SongDetail> {
  const body = await apiFetch<Record<string, unknown>>(`/api/v1/songs/${id}`, { method: 'PATCH', body: patch, signal });
  return songDetailFromDto(body);
}

/** `PUT /api/v1/songs/{id}/cover` — multipart `file`(512 JPEG). 200 `{ coverUrl }` */
export async function uploadSongCover(id: number, blob: Blob, signal?: AbortSignal): Promise<{ coverUrl: string }> {
  const form = new FormData();
  form.append('file', blob, 'cover.jpg');
  const body = await apiFetch<Record<string, unknown>>(`/api/v1/songs/${id}/cover`, { method: 'PUT', body: form, signal });
  return { coverUrl: typeof body?.coverUrl === 'string' ? body.coverUrl : '' };
}

/** `DELETE /api/v1/songs/{id}/cover` — 204 */
export async function deleteSongCover(id: number, signal?: AbortSignal): Promise<void> {
  await apiFetch(`/api/v1/songs/${id}/cover`, { method: 'DELETE', signal });
}

/** `DELETE /api/v1/songs/{id}` — 204. 채보·반주·커버가 함께 지워진다 */
export async function deleteSong(id: number, signal?: AbortSignal): Promise<void> {
  await apiFetch(`/api/v1/songs/${id}`, { method: 'DELETE', signal });
}
