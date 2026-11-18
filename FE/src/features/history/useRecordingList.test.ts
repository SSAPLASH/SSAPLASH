import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/error';
import type { PageResponse } from '@/api/play/recordings';
import type { RecordingSummary } from '@/domain/play/recording';
import { appendPage, buildListParams, listErrorMessage, type RecordingListData } from './useRecordingList';

const rec = (id: number): RecordingSummary => ({
  id,
  clientKey: `k${id}`,
  title: `녹음 ${id}`,
  mode: 'FREE',
  inputSource: 'KEYBOARD',
  playId: null,
  hitCount: 10,
  durationMs: 1000,
  startedAt: '2026-11-03T05:00:00Z',
  createdAt: '2026-11-03T05:00:00Z',
  updatedAt: '2026-11-03T05:00:00Z',
  song: null,
});

const page = (n: number, ids: number[], over: Partial<PageResponse<RecordingSummary>> = {}): PageResponse<RecordingSummary> => ({
  items: ids.map(rec),
  page: n,
  size: 20,
  totalElements: 25,
  totalPages: 2,
  hasNext: n === 0,
  ...over,
});

describe('buildListParams', () => {
  it('전체 모드·빈 검색어는 생략, size 20', () => {
    expect(buildListParams({ mode: 'ALL', sort: 'NEWEST', q: '' })).toEqual({
      q: undefined,
      page: 0,
      size: 20,
      sort: 'NEWEST',
      mode: undefined,
    });
  });

  it('모드·정렬·검색어(앞뒤 공백 제거)·페이지를 그대로 담는다', () => {
    expect(buildListParams({ mode: 'RHYTHM', sort: 'OLDEST', q: '  재즈 ' }, 2)).toEqual({
      q: '재즈',
      page: 2,
      size: 20,
      sort: 'OLDEST',
      mode: 'RHYTHM',
    });
  });

  it('공백뿐인 검색어는 생략', () => {
    expect(buildListParams({ mode: 'ALL', sort: 'NEWEST', q: '   ' }).q).toBeUndefined();
  });
});

describe('appendPage', () => {
  const empty: RecordingListData = { items: [], total: 0, hasNext: false };

  it('page 0은 교체하고 total·hasNext를 따른다', () => {
    const prev: RecordingListData = { items: [rec(99)], total: 1, hasNext: false };
    const next = appendPage(prev, page(0, [1, 2]));
    expect(next.items.map((i) => i.id)).toEqual([1, 2]);
    expect(next.total).toBe(25);
    expect(next.hasNext).toBe(true);
  });

  it('다음 쪽은 뒤에 이어 붙인다', () => {
    const first = appendPage(empty, page(0, [1, 2]));
    const next = appendPage(first, page(1, [3, 4]));
    expect(next.items.map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(next.hasNext).toBe(false);
  });

  it('이미 있는 id는 건너뛴다', () => {
    const first = appendPage(empty, page(0, [1, 2]));
    const next = appendPage(first, page(1, [2, 3]));
    expect(next.items.map((i) => i.id)).toEqual([1, 2, 3]);
  });
});

describe('listErrorMessage', () => {
  it('네트워크·5xx는 고정 문구', () => {
    expect(listErrorMessage(new ApiError(0, 'NETWORK', '서버에 연결할 수 없습니다.'))).toBe('목록을 불러오지 못했어요');
    expect(listErrorMessage(new ApiError(503, 'RECORDING_BUSY', '잠시 후'))).toBe('목록을 불러오지 못했어요');
    expect(listErrorMessage(new Error('x'))).toBe('목록을 불러오지 못했어요');
  });

  it('그 밖의 ApiError는 detail', () => {
    expect(listErrorMessage(new ApiError(400, 'RECORDING_INVALID', '검색어가 올바르지 않아요'))).toBe('검색어가 올바르지 않아요');
  });
});
