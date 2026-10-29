// 곡 커버 도메인 (설계 CHART-001 3-2). 고른 파일의 사전 검사, 정사각형 자르기 크기 계산, 커버 오류 재조회 간격(순수 함수).
// 기본 커버는 모든 곡에 같은 CD 그림이라 계산할 것이 없다(components/studio/SongCover).
// 캔버스 조작은 media/coverImage가 맡는다.

/** 고르는 원본 한도(줄이기 전): 10 MiB */
export const COVER_MAX_INPUT_BYTES = 10 * 1024 * 1024;

/** 보내는 커버 규격: 한 변 512px JPEG, 품질 0.85 (D3) */
export const COVER_OUTPUT = { size: 512, mime: 'image/jpeg', quality: 0.85 } as const;

export const COVER_ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** 파일 선택 input의 accept 값 */
export const COVER_ACCEPT = COVER_ACCEPT_TYPES.join(',');

/** 창에서 고른 커버 변화. 없음(null) / 새 이미지 / 지우기 */
export type CoverChange = { kind: 'set'; blob: Blob } | { kind: 'clear' };

export type CoverPrecheckReason = 'EMPTY' | 'UNSUPPORTED' | 'TOO_LARGE';
export type CoverPrecheck = { ok: true } | { ok: false; reason: CoverPrecheckReason };

export const COVER_PRECHECK_TEXT: Record<CoverPrecheckReason, string> = {
  EMPTY: '빈 파일입니다. 다른 이미지를 골라 주세요.',
  UNSUPPORTED: 'JPG·PNG·WebP 이미지만 쓸 수 있습니다.',
  TOO_LARGE: '이미지가 너무 큽니다. 10 MiB 이하만 고를 수 있어요.',
};

/** 고른 파일 사전 검사: 형식(jpeg·png·webp) → 빈 파일 → 원본 10 MiB 이하 */
export function precheckCover(file: { type: string; size: number }): CoverPrecheck {
  if (!(COVER_ACCEPT_TYPES as readonly string[]).includes(file.type)) return { ok: false, reason: 'UNSUPPORTED' };
  if (file.size <= 0) return { ok: false, reason: 'EMPTY' };
  if (file.size > COVER_MAX_INPUT_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  return { ok: true };
}

export interface SquareCrop {
  sx: number;
  sy: number;
  size: number;
}

/** 가운데 정사각형 자르기 영역. 정수로 내림하고 크기가 0이면 null */
export function centerSquareCrop(width: number, height: number): SquareCrop | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const size = Math.floor(Math.min(width, height));
  if (size <= 0) return null;
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

/** 커버 이미지 오류로 목록을 다시 읽는 최소 간격(U10). 서명 URL이 만료되면 카드 여럿이 한꺼번에 실패하므로 한 번만 읽는다 */
export const COVER_REFRESH_MIN_MS = 60_000;

/** 마지막 재조회 시각(없으면 null)과 지금 시각으로 목록을 다시 읽을지 정한다 */
export function coverRefreshDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= COVER_REFRESH_MIN_MS;
}
