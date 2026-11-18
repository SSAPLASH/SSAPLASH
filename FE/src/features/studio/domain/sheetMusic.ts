// 내 악보 보관 도메인 (설계 CHART-001 악보 보관·보기 3-2, 4-5). 타입·업로드 전 검사·오류 문구·만료 판단·라이브러리 목록 합치기. 네트워크는 api/sheets가 맡는다.
import { createdTime, mineGroup, type SongSummary } from '@/domain/song/songCatalog';

/** BE `kind` */
export type SheetKind = 'IMAGE' | 'PDF';

/** 악보 목록 항목. `songId`는 BE가 곡 연결을 붙이기 전엔 응답에 없어 null */
export interface SheetSummary {
  id: number;
  title: string;
  kind: SheetKind;
  pageCount: number;
  /** 이미지 악보의 1쪽 보기 URL. PDF는 null */
  thumbnailUrl: string | null;
  /** ISO 문자열 */
  createdAt: string;
  songId: number | null;
}

export interface SheetPage {
  pageNo: number;
  url: string;
  contentType: string;
  /** BE가 모르면 0 */
  width: number;
  height: number;
}

export interface SheetDetail extends SheetSummary {
  pages: SheetPage[];
  /** 보기 URL 만료 시각(ms) */
  expiresAt: number;
}

/** 악보 목록 한 쪽 */
export interface SheetPageResult {
  items: SheetSummary[];
  hasNext: boolean;
}

/** 라이브러리 합친 목록 항목 */
export type LibraryItem = { type: 'song'; song: SongSummary } | { type: 'sheet'; sheet: SheetSummary };

/** 업로드 전 파일 검사 실패 원인 */
export type SheetFileReason = 'MIXED' | 'TOO_MANY' | 'UNSUPPORTED' | 'TOO_LARGE' | 'EMPTY';

export interface SheetFileCheck {
  ok: boolean;
  /** 한 종류로 정해지면 그 종류, 아니면 null */
  kind: SheetKind | null;
  reason?: SheetFileReason;
}

/** 악보 API 실패. `api/error.ts`의 ApiError와 같은 모양(code·status)이고 네트워크 실패는 code 'NETWORK'·status 0 */
export class SheetError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message = code, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SheetError';
    this.code = code;
    this.status = status;
  }
}

/** 이미지 장당 상한(BE 10 MiB) */
export const SHEET_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** PDF 상한(BE 20 MiB) */
export const SHEET_PDF_MAX_BYTES = 20 * 1024 * 1024;
/** 이미지 최대 장수 */
export const SHEET_MAX_IMAGES = 20;
/** 제목 글자 수 상한 */
export const SHEET_TITLE_MAX = 100;
/** 목록을 한 번에 읽는 크기(회원당 최대 100개) */
export const SHEET_LIST_SIZE = 100;
/** 보기 URL 만료 이 시간(ms) 전부터 갱신한다 */
export const SHEET_REFRESH_LEAD_MS = 2 * 60 * 1000;

const IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const PDF_EXT = /\.pdf$/i;

type FileLike = Pick<File, 'name' | 'type' | 'size'>;

function fileKind(f: FileLike): SheetKind | null {
  if (f.type === 'application/pdf') return 'PDF';
  if (IMAGE_TYPES.includes(f.type)) return 'IMAGE';
  // 브라우저가 type을 비워 줄 때는 확장자로 본다
  if (f.type === '') {
    if (PDF_EXT.test(f.name)) return 'PDF';
    if (IMAGE_EXT.test(f.name)) return 'IMAGE';
  }
  return null;
}

/**
 * 올릴 파일을 BE 요청 전에 검사한다(D11). 순서: 비었음 → 이미지·PDF 섞임 → 개수 → 형식 → 크기. 화소 상한은 BE의 400을 따른다.
 * 최종 판단은 BE 응답이다.
 */
export function validateSheetFiles(files: readonly FileLike[]): SheetFileCheck {
  if (files.length === 0) return { ok: false, kind: null, reason: 'EMPTY' };
  const kinds = files.map(fileKind);
  const images = kinds.filter((k) => k === 'IMAGE').length;
  const pdfs = kinds.filter((k) => k === 'PDF').length;
  if (images > 0 && pdfs > 0) return { ok: false, kind: null, reason: 'MIXED' };
  if (pdfs > 1 || images > SHEET_MAX_IMAGES) return { ok: false, kind: pdfs > 1 ? 'PDF' : 'IMAGE', reason: 'TOO_MANY' };
  if (kinds.some((k) => k === null)) return { ok: false, kind: null, reason: 'UNSUPPORTED' };
  const kind: SheetKind = pdfs === 1 ? 'PDF' : 'IMAGE';
  const limit = kind === 'PDF' ? SHEET_PDF_MAX_BYTES : SHEET_IMAGE_MAX_BYTES;
  if (files.some((f) => f.size > limit)) return { ok: false, kind, reason: 'TOO_LARGE' };
  return { ok: true, kind };
}

const REASON_TEXT: Record<SheetFileReason, string> = {
  MIXED: '이미지와 PDF를 함께 올릴 수 없어요',
  TOO_MANY: '이미지는 20장까지, PDF는 1개만 올릴 수 있어요',
  UNSUPPORTED: 'JPG·PNG·WEBP 이미지나 PDF만 올릴 수 있어요',
  TOO_LARGE: '이미지는 장당 10MB, PDF는 20MB까지예요',
  EMPTY: '올릴 파일을 골라 주세요',
};

/** BE 오류 코드(또는 검사 원인·NETWORK)를 사용자 문구로. 모르는 코드는 일시 오류 문구 */
export function sheetErrorText(code: string): string {
  switch (code) {
    case 'MIXED':
    case 'TOO_MANY':
    case 'UNSUPPORTED':
    case 'TOO_LARGE':
    case 'EMPTY':
      return REASON_TEXT[code];
    case 'SHEET_UNSUPPORTED':
      return REASON_TEXT.UNSUPPORTED;
    case 'SHEET_TOO_LARGE':
      return REASON_TEXT.TOO_LARGE;
    case 'SHEET_QUOTA_EXCEEDED':
      return '악보는 100개·500MB까지 보관할 수 있어요';
    case 'SHEET_ALREADY_LINKED':
      return '이 곡에는 이미 악보가 있어요';
    case 'SONG_NOT_FOUND':
      return '곡을 찾을 수 없어요. 목록을 새로 고쳐 주세요';
    case 'SHEET_NOT_FOUND':
      return '지워졌거나 주소가 틀렸어요';
    case 'SHEET_INVALID':
      return '파일을 읽을 수 없어요. 다른 파일로 올려 주세요';
    default:
      // SHEET_UNAVAILABLE·NETWORK·그 밖
      return '지금은 올릴 수 없어요. 잠시 뒤 다시 시도해 주세요';
  }
}

/** 오류 객체에서 code를 읽는다(SheetError·ApiError). code가 없는 오류는 NETWORK로 본다 */
export function sheetErrorCodeOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string') return (e as { code: string }).code;
  return 'NETWORK';
}

/** 보기 URL 만료 2분 전부터 참(ms) */
export function needsRefresh(expiresAt: number, now: number): boolean {
  return now >= expiresAt - SHEET_REFRESH_LEAD_MS;
}

/** 제목 검사: 앞뒤 공백을 뺀 1~100자 */
export function isValidSheetTitle(title: string): boolean {
  const t = title.trim();
  return t.length >= 1 && t.length <= SHEET_TITLE_MAX;
}

/**
 * 라이브러리 합친 목록. 곡은 모두 넣고, 악보는 songId가 null이거나 목록에 없는 곡을 가리키면 악보 항목으로 넣는다.
 * songId가 목록의 곡을 가리키면 그 곡 안으로 들어가므로 따로 넣지 않는다.
 * 정렬은 내 곡 규칙(처리 중 → 실패 → 그 밖, 같은 그룹은 createdAt 내림차순). 악보 항목은 「그 밖」 그룹이다.
 */
export function mergeLibraryItems(songs: readonly SongSummary[], sheets: readonly SheetSummary[]): LibraryItem[] {
  const songIds = new Set(songs.map((s) => s.id));
  const items: LibraryItem[] = songs.map((song) => ({ type: 'song', song }));
  for (const sheet of sheets) {
    if (sheet.songId !== null && songIds.has(sheet.songId)) continue;
    items.push({ type: 'sheet', sheet });
  }
  const group = (it: LibraryItem) => (it.type === 'song' ? mineGroup(it.song.status) : 2);
  const time = (it: LibraryItem) => createdTime(it.type === 'song' ? it.song.createdAt : it.sheet.createdAt);
  return items.sort((a, b) => group(a) - group(b) || time(b) - time(a));
}
