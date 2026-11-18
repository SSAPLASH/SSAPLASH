// 악보 연습 곡 고르기의 범위(기본 곡·내 곡·AI 추천곡·학습 코스)와 주소 값 변환 (설계 MODE-003-악보-연습-하위-메뉴).
// 사이드바 하위 메뉴(components/shell/Sidebar)와 곡 고르기(features/play SongPicker)가 서로를 모른 채 같은 주소 값을 보도록 여기에 둔다.
// 순수 함수만 둔다. React·스토어·라우터에 접근하지 않는다.
import type { SongScope } from './songCatalog';

/** 곡 고르기 범위. 기본 곡·내 곡은 곡 목록 scope, RECOMMEND는 추천 결과, LESSONS는 학습 코스(입문·중급) */
export type SheetCategory = SongScope | 'RECOMMEND' | 'LESSONS';

/** 악보 연습 경로. 곡 고르기는 이 경로이고 알아보기 레슨 화면은 `/sheet/lesson/:songId`다 */
export const SHEET_PATH = '/sheet';
const SHEET_LESSON_PREFIX = `${SHEET_PATH}/lesson/`;

/** 주소 `tab` 값 */
export const SHEET_TAB_RECOMMEND = 'recommend';
export const SHEET_TAB_LESSONS = 'lessons';

/** 보이는 순서 */
const ORDER: readonly SheetCategory[] = ['BUILTIN', 'MINE', 'RECOMMEND', 'LESSONS'];

/**
 * 표시 이름. 사이드바 하위 메뉴와 화면 위 버튼(악보 연습·리듬 게임)이 같은 이름을 쓴다(설계 SETUP-학습-코스-중급 3-6).
 * 사이드바에는 이미 「라이브러리」(곡 작업실) 메뉴가 있어 내 곡 범위는 「내 곡」으로 적는다
 */
export const SHEET_CATEGORY_LABEL: Record<SheetCategory, string> = {
  BUILTIN: '기본 곡',
  MINE: '내 곡',
  RECOMMEND: 'AI 추천곡',
  LESSONS: '학습 코스',
};

/** 주소 값 → 범위. `tab`이 `scope`보다 먼저다. 값이 없거나 모르는 값이면 기본 곡 */
export function sheetCategoryOf(query: { tab: string | null; scope: string | null }): SheetCategory {
  if (query.tab === SHEET_TAB_LESSONS) return 'LESSONS';
  if (query.tab === SHEET_TAB_RECOMMEND) return 'RECOMMEND';
  return query.scope === 'MINE' ? 'MINE' : 'BUILTIN';
}

/** 범위 → 주소에 남길 값. 돌려주지 않은 키(`tab`·`scope`)는 주소에서 지운다 */
export function sheetCategoryQuery(category: SheetCategory): { tab?: string; scope?: string } {
  switch (category) {
    case 'MINE':
      return { scope: 'MINE' };
    case 'RECOMMEND':
      return { tab: SHEET_TAB_RECOMMEND };
    case 'LESSONS':
      return { tab: SHEET_TAB_LESSONS };
    default:
      return {};
  }
}

/** 범위 → 링크용 주소 뒷부분(`?…`). 기본 곡은 빈 문자열 */
export function sheetCategorySearch(category: SheetCategory): string {
  const q = sheetCategoryQuery(category);
  const pairs = [q.tab ? `tab=${q.tab}` : '', q.scope ? `scope=${q.scope}` : ''].filter(Boolean);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/**
 * 보일 범위. 내장 곡 출처(개발용)는 범위를 나누지 않는다(빈 목록).
 * AI 추천곡·입문 코스는 로그인 검사를 하는 빌드에서 로그인했을 때만 보인다(설계 COACH-004 추천, SETUP 입문 코스 3-5)
 */
export function visibleSheetCategories(cond: { source: 'api' | 'builtin'; authed: boolean; authRequired: boolean }): SheetCategory[] {
  if (cond.source !== 'api') return [];
  const personal = cond.authRequired && cond.authed;
  return ORDER.filter((c) => personal || c === 'BUILTIN' || c === 'MINE');
}

/** 보이지 않는 범위(로그인이 풀려 사라진 탭 등)는 기본 곡으로 본다 */
export function resolveSheetCategory(category: SheetCategory, visible: readonly SheetCategory[]): SheetCategory {
  return visible.includes(category) ? category : 'BUILTIN';
}

/** 지금 경로가 악보 연습 안인가(곡 고르기·알아보기 레슨 화면) */
export function isSheetPath(pathname: string): boolean {
  return pathname === SHEET_PATH || pathname.startsWith(`${SHEET_PATH}/`);
}

/** 지금 주소의 범위. 알아보기 레슨 화면은 입문 코스이고, 그 밖에는 주소 값(`tab`·`scope`)대로 읽는다 */
export function sheetCategoryAt(pathname: string, search: string): SheetCategory {
  if (pathname.startsWith(SHEET_LESSON_PREFIX)) return 'LESSONS';
  const params = new URLSearchParams(search);
  return sheetCategoryOf({ tab: params.get('tab'), scope: params.get('scope') });
}
