// 곡 커버 도메인 (설계 CHART-001 3-2). 기본 커버 색·글자, 고른 파일의 사전 검사, 정사각형 자르기 크기 계산(순수 함수).
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

export interface DefaultCover {
  /** 0~359 */
  hue: number;
  letter: string;
}

/** 문자열 해시(31 곱셈, 부호 없는 32비트). 같은 입력은 언제나 같은 값 */
function hashString(s: string): number {
  let h = 0;
  for (const ch of s) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** 기본 커버: 제목 해시로 색, trim한 첫 글자(한글·영문·숫자, 영문은 대문자)를 글자로. 없으면 ♪ */
export function defaultCover(title: string): DefaultCover {
  const t = title.trim();
  const first = Array.from(t)[0] ?? '';
  const letter = /^[가-힣a-zA-Z0-9]$/.test(first) ? first.toUpperCase() : '♪';
  return { hue: hashString(t) % 360, letter };
}
