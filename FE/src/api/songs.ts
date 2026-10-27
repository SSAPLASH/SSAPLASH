// 곡 API (BE 96, 설계 3-1). 응답 숫자 id·bpm 변환까지만 하고 Chart 변환은 domain/chartMapping이 맡는다.
import type { UploadDraft } from '@/domain/chartJob';
import { songDetailFromDto, songFromDto, toSafeId, type SongDetail, type SongPage, type SongScope } from '@/domain/songCatalog';
import { apiFetch } from './http';

export interface ListSongsParams {
  source: SongScope;
  q?: string;
  page?: number;
  size?: number;
}

/** `GET /api/v1/songs` */
export async function listSongs(params: ListSongsParams, signal?: AbortSignal): Promise<SongPage> {
  const qs = new URLSearchParams({ source: params.source });
  const q = params.q?.trim();
  if (q) qs.set('q', q);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.size !== undefined) qs.set('size', String(params.size));
  const body = await apiFetch<{ items?: Record<string, unknown>[]; hasNext?: boolean }>(`/api/v1/songs?${qs}`, { signal });
  return { items: (body.items ?? []).map(songFromDto), hasNext: body.hasNext === true };
}

/** `GET /api/v1/songs/{id}` — 난이도별 채보 요약 포함 */
export async function getSong(id: number, signal?: AbortSignal): Promise<SongDetail> {
  const body = await apiFetch<Record<string, unknown>>(`/api/v1/songs/${id}`, { signal });
  return songDetailFromDto(body);
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
