// 내 악보 보관 API (BE 155, 설계 CHART-001 악보 보관 3-1). 응답을 도메인 타입으로 바꾸고 실패를 SheetError로 바꾼다.
import { SHEET_LIST_SIZE, SheetError, type SheetDetail, type SheetKind, type SheetPage, type SheetPageResult, type SheetSummary } from '@/features/studio/domain/sheetMusic';
import { toSafeId } from '@/domain/song/songCatalog';
import { ApiError } from '@/api/error';
import { apiFetch } from '@/api/http';

type Dto = Record<string, unknown>;

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function summaryFromDto(d: Dto): SheetSummary {
  const kind: SheetKind = d.kind === 'PDF' ? 'PDF' : 'IMAGE';
  return {
    id: toSafeId(d.id, 'sheetId'),
    title: String(d.title ?? ''),
    kind,
    pageCount: toNum(d.pageCount),
    thumbnailUrl: typeof d.thumbnailUrl === 'string' && d.thumbnailUrl !== '' ? d.thumbnailUrl : null,
    createdAt: String(d.createdAt ?? ''),
    songId: d.songId == null ? null : toSafeId(d.songId, 'songId'),
  };
}

function pageFromDto(d: Dto): SheetPage {
  return {
    pageNo: toNum(d.pageNo),
    url: String(d.url ?? ''),
    contentType: String(d.contentType ?? ''),
    width: toNum(d.width),
    height: toNum(d.height),
  };
}

/** 응답 상세를 도메인 타입으로. `expiresAt`(ISO)은 ms로, 해석 못 하면 0(바로 갱신 대상) */
export function sheetDetailFromDto(d: Dto): SheetDetail {
  const expires = typeof d.expiresAt === 'string' ? Date.parse(d.expiresAt) : NaN;
  return {
    ...summaryFromDto(d),
    pages: (Array.isArray(d.pages) ? (d.pages as Dto[]) : []).map(pageFromDto).sort((a, b) => a.pageNo - b.pageNo),
    expiresAt: Number.isFinite(expires) ? expires : 0,
  };
}

/** ApiError를 SheetError로 바꿔 던진다. 취소(AbortError) 등 그 밖의 오류는 그대로 던진다 */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ApiError) throw new SheetError(e.code, e.status, e.detail, { cause: e });
    throw e;
  }
}

/** `GET /api/v1/sheets` — 최신순. size=100으로 한 번에 읽는다(회원당 최대 100개) */
export function listSheets(signal?: AbortSignal): Promise<SheetPageResult> {
  return call(async () => {
    const body = await apiFetch<{ items?: Dto[]; hasNext?: boolean }>(`/api/v1/sheets?page=0&size=${SHEET_LIST_SIZE}`, { signal });
    return { items: (body.items ?? []).map(summaryFromDto), hasNext: body.hasNext === true };
  });
}

/** `GET /api/v1/sheets/{id}` — 쪽 URL(1시간 서명)과 `expiresAt` 포함 */
export function getSheet(id: number, signal?: AbortSignal): Promise<SheetDetail> {
  return call(async () => sheetDetailFromDto(await apiFetch<Dto>(`/api/v1/sheets/${id}`, { signal })));
}

export interface UploadSheetInput {
  /** 고른 순서 = 쪽 순서 */
  files: readonly File[];
  title: string;
  /** 곡 연결(링크 스위치 켜짐일 때만). 없으면 파트를 보내지 않는다 */
  songId?: number | null;
}

/** `POST /api/v1/sheets` — multipart. `files`는 같은 이름으로 순서대로, `songId` 파트는 값이 있을 때만. 201 악보 상세 */
export function uploadSheet(input: UploadSheetInput, signal?: AbortSignal): Promise<SheetDetail> {
  return call(async () => {
    const form = new FormData();
    for (const f of input.files) form.append('files', f);
    form.append('title', input.title.trim());
    if (input.songId != null) form.append('songId', String(input.songId));
    return sheetDetailFromDto(await apiFetch<Dto>('/api/v1/sheets', { method: 'POST', body: form, signal }));
  });
}

/** `PATCH /api/v1/sheets/{id}` — 제목만 */
export function updateSheetTitle(id: number, title: string, signal?: AbortSignal): Promise<SheetDetail> {
  return call(async () =>
    sheetDetailFromDto(await apiFetch<Dto>(`/api/v1/sheets/${id}`, { method: 'PATCH', body: { title: title.trim() }, signal })),
  );
}

/** `PATCH /api/v1/sheets/{id}` — 곡 연결(나중 연결, D16). `songId`가 null이면 연결을 해제한다. 응답은 악보 상세 */
export function linkSheetToSong(id: number, songId: number | null, signal?: AbortSignal): Promise<SheetDetail> {
  return call(async () => sheetDetailFromDto(await apiFetch<Dto>(`/api/v1/sheets/${id}`, { method: 'PATCH', body: { songId }, signal })));
}

/** `DELETE /api/v1/sheets/{id}` — 204 */
export function deleteSheet(id: number, signal?: AbortSignal): Promise<void> {
  return call(() => apiFetch(`/api/v1/sheets/${id}`, { method: 'DELETE', signal }));
}
