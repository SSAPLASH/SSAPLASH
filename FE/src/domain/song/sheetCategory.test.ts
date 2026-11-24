import { describe, expect, it } from 'vitest';
import {
  isPlayPath,
  isSheetPath,
  resolveSheetCategory,
  sheetCategoryAt,
  SHEET_CATEGORY_LABEL,
  sheetCategoryOf,
  sheetCategoryQuery,
  sheetCategorySearch,
  visiblePlayCategories,
  visibleSheetCategories,
  type SheetCategory,
} from './sheetCategory';

describe('sheetCategoryOf: 주소 값 → 범위', () => {
  it('값이 없으면 기본 곡', () => {
    expect(sheetCategoryOf({ tab: null, scope: null })).toBe('BUILTIN');
  });

  it('scope=MINE은 내 곡, tab=recommend는 AI 추천곡, tab=lessons는 입문 코스', () => {
    expect(sheetCategoryOf({ tab: null, scope: 'MINE' })).toBe('MINE');
    expect(sheetCategoryOf({ tab: 'recommend', scope: null })).toBe('RECOMMEND');
    expect(sheetCategoryOf({ tab: 'lessons', scope: null })).toBe('LESSONS');
  });

  it('tab이 scope보다 먼저다(둘 다 있으면 tab)', () => {
    expect(sheetCategoryOf({ tab: 'lessons', scope: 'MINE' })).toBe('LESSONS');
    expect(sheetCategoryOf({ tab: 'recommend', scope: 'MINE' })).toBe('RECOMMEND');
  });

  it('모르는 값은 무시한다', () => {
    expect(sheetCategoryOf({ tab: 'xyz', scope: null })).toBe('BUILTIN');
    expect(sheetCategoryOf({ tab: 'xyz', scope: 'MINE' })).toBe('MINE');
    expect(sheetCategoryOf({ tab: null, scope: 'BUILTIN' })).toBe('BUILTIN');
    expect(sheetCategoryOf({ tab: 'LESSONS', scope: 'mine' })).toBe('BUILTIN');
  });
});

describe('sheetCategoryQuery·sheetCategorySearch: 범위 → 주소 값', () => {
  it('범위마다 남길 값만 돌려준다(없는 키는 주소에서 지운다)', () => {
    expect(sheetCategoryQuery('BUILTIN')).toEqual({});
    expect(sheetCategoryQuery('MINE')).toEqual({ scope: 'MINE' });
    expect(sheetCategoryQuery('RECOMMEND')).toEqual({ tab: 'recommend' });
    expect(sheetCategoryQuery('LESSONS')).toEqual({ tab: 'lessons' });
  });

  it('사이드바 링크용 주소 뒷부분', () => {
    expect(sheetCategorySearch('BUILTIN')).toBe('');
    expect(sheetCategorySearch('MINE')).toBe('?scope=MINE');
    expect(sheetCategorySearch('RECOMMEND')).toBe('?tab=recommend');
    expect(sheetCategorySearch('LESSONS')).toBe('?tab=lessons');
  });

  it('주소 값으로 바꿨다가 다시 읽으면 같은 범위다', () => {
    for (const c of ['BUILTIN', 'MINE', 'RECOMMEND', 'LESSONS'] as SheetCategory[]) {
      const q = sheetCategoryQuery(c);
      expect(sheetCategoryOf({ tab: q.tab ?? null, scope: q.scope ?? null })).toBe(c);
    }
  });
});

describe('visibleSheetCategories: 보일 범위', () => {
  it('서버 곡 출처 + 로그인이면 네 범위가 이 순서로 보인다', () => {
    expect(visibleSheetCategories({ source: 'api', authed: true, authRequired: true })).toEqual(['BUILTIN', 'MINE', 'RECOMMEND', 'LESSONS']);
  });

  it('로그인하지 않았으면 기본 곡·내 곡만', () => {
    expect(visibleSheetCategories({ source: 'api', authed: false, authRequired: true })).toEqual(['BUILTIN', 'MINE']);
  });

  it('로그인 검사를 끈 빌드는 로그인 상태여도 기본 곡·내 곡만', () => {
    expect(visibleSheetCategories({ source: 'api', authed: true, authRequired: false })).toEqual(['BUILTIN', 'MINE']);
  });

  it('내장 곡 출처(개발용)는 범위를 나누지 않는다', () => {
    expect(visibleSheetCategories({ source: 'builtin', authed: true, authRequired: true })).toEqual([]);
  });
});

describe('resolveSheetCategory: 보이지 않는 범위는 기본 곡으로 본다', () => {
  it('보이는 범위는 그대로', () => {
    expect(resolveSheetCategory('LESSONS', ['BUILTIN', 'MINE', 'RECOMMEND', 'LESSONS'])).toBe('LESSONS');
    expect(resolveSheetCategory('MINE', ['BUILTIN', 'MINE'])).toBe('MINE');
  });

  it('로그인이 풀려 사라진 범위는 기본 곡', () => {
    expect(resolveSheetCategory('RECOMMEND', ['BUILTIN', 'MINE'])).toBe('BUILTIN');
    expect(resolveSheetCategory('LESSONS', ['BUILTIN', 'MINE'])).toBe('BUILTIN');
  });
});

describe('SHEET_CATEGORY_LABEL: 표시 이름(학습 코스 설계 3-6절)', () => {
  it('사이드바 하위 메뉴와 화면 위 버튼이 같은 이름이다: 기본 곡 · 내 곡 · AI 추천곡 · 학습 코스', () => {
    expect(SHEET_CATEGORY_LABEL).toEqual({ BUILTIN: '기본 곡', MINE: '내 곡', RECOMMEND: 'AI 추천곡', LESSONS: '학습 코스' });
  });
});

describe('isSheetPath·sheetCategoryAt: 지금 주소 → 악보 연습 안인지, 어느 범위인지', () => {
  it('/sheet와 그 아래 경로만 악보 연습이다', () => {
    expect(isSheetPath('/sheet')).toBe(true);
    expect(isSheetPath('/sheet/lesson/12')).toBe(true);
    expect(isSheetPath('/sheets')).toBe(false);
    expect(isSheetPath('/play')).toBe(false);
    expect(isSheetPath('/studio/sheets/3')).toBe(false);
  });

  it('곡 고르기 주소는 값대로 읽는다(곡·단계 값이 섞여 있어도)', () => {
    expect(sheetCategoryAt('/sheet', '')).toBe('BUILTIN');
    expect(sheetCategoryAt('/sheet', '?scope=MINE&song=3')).toBe('MINE');
    expect(sheetCategoryAt('/sheet', '?song=3&chart=31&tab=recommend')).toBe('RECOMMEND');
    expect(sheetCategoryAt('/sheet', '?tab=lessons&song=9&chart=91&start=1')).toBe('LESSONS');
  });

  it('알아보기 레슨 화면(/sheet/lesson/…)은 입문 코스다', () => {
    expect(sheetCategoryAt('/sheet/lesson/12', '')).toBe('LESSONS');
  });
});

describe('isPlayPath: 리듬 게임 경로', () => {
  it('/play와 그 아래만 참이다', () => {
    expect(isPlayPath('/play')).toBe(true);
    expect(isPlayPath('/play/mini')).toBe(true);
    expect(isPlayPath('/play/mini/speed')).toBe(true);
    expect(isPlayPath('/playground')).toBe(false);
    expect(isPlayPath('/sheet')).toBe(false);
    expect(isPlayPath('/')).toBe(false);
  });
});

describe('visiblePlayCategories: 리듬 게임에서 보일 범위', () => {
  it('내장 곡 출처(개발용)는 빈 목록이다', () => {
    expect(visiblePlayCategories({ source: 'builtin', authed: true, authRequired: true })).toEqual([]);
  });

  it('로그인하지 않았거나 로그인 검사를 안 하는 빌드면 기본 곡·내 곡', () => {
    expect(visiblePlayCategories({ source: 'api', authed: false, authRequired: true })).toEqual(['BUILTIN', 'MINE']);
    expect(visiblePlayCategories({ source: 'api', authed: true, authRequired: false })).toEqual(['BUILTIN', 'MINE']);
  });

  it('로그인했으면 AI 추천곡이 붙고 학습 코스는 어느 경우에도 없다', () => {
    expect(visiblePlayCategories({ source: 'api', authed: true, authRequired: true })).toEqual(['BUILTIN', 'MINE', 'RECOMMEND']);
  });
});
