// 녹음 API (REC-001, BE 256·257). 재시도 정책은 runtime/recordingSync가 맡는다.
import type { RecordingBody, RecordingDetail, RecordingMode, RecordingSort, RecordingSummary } from '@/domain/play/recording';
import { apiFetch } from '@/api/http';

const BASE = '/api/v1/recordings';

/** BE `PageResponse` (page는 0부터) */
export interface PageResponse<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasNext: boolean;
}

export interface ListRecordingsParams {
  q?: string;
  page?: number;
  size?: number;
  sort?: RecordingSort;
  /** 생략하면 전체 */
  mode?: RecordingMode;
}

/** 257 병합 전 응답에는 song이 없을 수 있다. undefined를 null로 맞춘다 */
function normalize<T extends { song?: RecordingSummary['song'] }>(r: T): T & { song: RecordingSummary['song'] } {
  return { ...r, song: r.song ?? null };
}

/** `POST /api/v1/recordings` — 신규 201, 같은 clientKey·본문 재전송 200. 둘 다 성공으로 본다 */
export async function saveRecording(body: RecordingBody, signal?: AbortSignal): Promise<RecordingSummary> {
  return normalize(await apiFetch<RecordingSummary>(BASE, { method: 'POST', body, signal }));
}

/** `GET /api/v1/recordings` — 값이 없는 쿼리는 넣지 않는다 */
export async function listRecordings(params: ListRecordingsParams = {}, signal?: AbortSignal): Promise<PageResponse<RecordingSummary>> {
  const qs = new URLSearchParams();
  const q = params.q?.trim();
  if (q) qs.set('q', q);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.size !== undefined) qs.set('size', String(params.size));
  if (params.sort) qs.set('sort', params.sort);
  if (params.mode) qs.set('mode', params.mode);
  const query = qs.toString();
  const res = await apiFetch<PageResponse<RecordingSummary>>(query ? `${BASE}?${query}` : BASE, { signal });
  return { ...res, items: (res.items ?? []).map(normalize) };
}

/** `GET /api/v1/recordings/{id}` — 타격 시퀀스 포함 */
export async function getRecording(id: number, signal?: AbortSignal): Promise<RecordingDetail> {
  return normalize(await apiFetch<RecordingDetail>(`${BASE}/${id}`, { signal }));
}

/** `PATCH /api/v1/recordings/{id}` — 본문은 `{title}`만 */
export async function renameRecording(id: number, title: string, signal?: AbortSignal): Promise<RecordingSummary> {
  return normalize(await apiFetch<RecordingSummary>(`${BASE}/${id}`, { method: 'PATCH', body: { title }, signal }));
}

/** `DELETE /api/v1/recordings/{id}` — 204 */
export async function deleteRecording(id: number, signal?: AbortSignal): Promise<void> {
  await apiFetch(`${BASE}/${id}`, { method: 'DELETE', signal });
}
