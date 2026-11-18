// 연주 화면(PlayPage·SheetPage)과 곡 선택이 같이 쓰는 값. React·패키지를 모르는 순수 값이다.
import type { Lesson } from '@/domain/play/lesson';

/** 카운트인이 끝난 직후 「시작!」을 보이는 시간 */
export const GO_MS = 400;

/** URL 쿼리 문자열을 안전한 정수로. 정수가 아니면 null */
export function parseId(raw: string | null): number | null {
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** 입문 코스 목록을 아직 못 읽었을 때 쓰는 빈 목록(구독 값 정체성 유지) */
export const NO_LESSONS: readonly Lesson[] = [];
