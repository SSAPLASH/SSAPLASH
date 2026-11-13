// 녹음 보관함 목록 조회 훅 (설계 REC-001 3-8·6-2). 모드·정렬·검색어가 바뀌면 page 0부터 다시 조회하고,
// [더 보기]는 page + 1을 이어 붙인다. 검색어는 300ms 디바운스.
// 목록은 서버 데이터 캐시(쪽 단위 쿼리)가 갖는다(설계 TECH-351). 조건별로 캐시되어 다시 들어오면 바로 보이고,
// 제목 변경·삭제는 캐시 행을 고친다. 503은 공통 정책(5xx 1초 뒤 1회)이 재시도한다.
// 조회 로직의 순수 부분(buildListParams·appendPage·listErrorMessage)은 따로 export해 테스트한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { ApiError } from '@/api/error';
import { recordingKeys, recordingListQuery } from '@/api/play/recordingQueries';
import type { ListRecordingsParams, PageResponse } from '@/api/play/recordings';
import { queryClient } from '@/runtime/queryClient';
import type { RecordingMode, RecordingSort, RecordingSummary } from '@/domain/play/recording';

/** 모드 필터 값. ALL이면 mode 쿼리를 생략한다 */
export type RecordingModeFilter = 'ALL' | Exclude<RecordingMode, 'TEMPO'>;

export const RECORDING_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;
export const BUSY_RETRY_MS = 1000;

export interface RecordingListQuery {
  mode: RecordingModeFilter;
  sort: RecordingSort;
  q: string;
}

/** 누적된 목록 */
export interface RecordingListData {
  items: RecordingSummary[];
  total: number;
  hasNext: boolean;
}

/** 조회 조건 → API 쿼리. 빈 검색어·전체 모드는 생략한다 */
export function buildListParams(query: RecordingListQuery, page = 0): ListRecordingsParams {
  const q = query.q.trim();
  return {
    q: q || undefined,
    page,
    size: RECORDING_PAGE_SIZE,
    sort: query.sort,
    mode: query.mode === 'ALL' ? undefined : query.mode,
  };
}

/** 응답 병합. page 0이면 교체, 아니면 이어 붙인다(앞쪽에 새 녹음이 생겨 밀린 중복 id는 건너뜀) */
export function appendPage(prev: RecordingListData, res: PageResponse<RecordingSummary>): RecordingListData {
  let items: RecordingSummary[];
  if (res.page === 0) {
    items = res.items;
  } else {
    const seen = new Set(prev.items.map((i) => i.id));
    items = [...prev.items, ...res.items.filter((i) => !seen.has(i.id))];
  }
  return { items, total: res.totalElements, hasNext: res.hasNext };
}

/** 목록 오류 문구. 네트워크·5xx는 고정 문구, 그 밖의 ApiError는 detail */
export function listErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status > 0 && e.status < 500) return e.detail;
  return '목록을 불러오지 못했어요';
}

export interface UseRecordingList extends RecordingListData {
  /** 첫 쪽(조건 변경·다시 불러오기) 조회 중 */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => void;
  /** page 0 재조회 */
  reload: () => void;
  /** 제목 변경 응답으로 행 교체(7c) */
  replaceItem: (summary: RecordingSummary) => void;
  /** 삭제된 행 제거, 있었으면 total - 1(7c) */
  removeItem: (id: number) => void;
}

const EMPTY: RecordingListData = { items: [], total: 0, hasNext: false };

type Pages = InfiniteData<PageResponse<RecordingSummary>, number>;

/** 캐시된 모든 쪽의 행을 고친다. 삭제면 각 쪽의 totalElements도 1 줄인다 */
function patchPages(data: Pages | undefined, fn: (items: RecordingSummary[]) => RecordingSummary[], totalDelta = 0): Pages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items), totalElements: Math.max(0, p.totalElements + totalDelta) })) };
}

export function useRecordingList({ mode, sort, q }: RecordingListQuery): UseRecordingList {
  const [debouncedQ, setDebouncedQ] = useState(q);

  // 검색어만 300ms 디바운스(모드·정렬은 즉시)
  useEffect(() => {
    if (q === debouncedQ) return;
    const t = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, debouncedQ]);

  const { page: _page, ...keyParams } = buildListParams({ mode, sort, q: debouncedQ }, 0);
  const options = recordingListQuery(keyParams);
  const key = options.queryKey;
  const query = useInfiniteQuery(options, queryClient);

  // 쪽들을 순서대로 이어 붙인다(앞쪽에 새 녹음이 생겨 밀린 중복 id는 건너뜀)
  const data = useMemo(() => (query.data ? query.data.pages.reduce(appendPage, EMPTY) : EMPTY), [query.data]);
  const loading = query.isPending;
  const loadingMore = query.isFetchingNextPage;
  const error = query.isError ? listErrorMessage(query.error) : null;

  const { hasNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (!hasNextPage || loadingMore || loading) return;
    void fetchNextPage();
  }, [hasNextPage, loadingMore, loading, fetchNextPage]);

  // page 0부터 다시(이어 받은 쪽은 버린다)
  const keyJson = JSON.stringify(key);
  const reload = useCallback(() => {
    void queryClient.resetQueries({ queryKey: JSON.parse(keyJson), exact: true });
  }, [keyJson]);

  const replaceItem = useCallback((summary: RecordingSummary) => {
    queryClient.setQueriesData<Pages>({ queryKey: recordingKeys.all }, (old) => patchPages(old, (items) => items.map((i) => (i.id === summary.id ? summary : i))));
  }, []);

  const removeItem = useCallback((id: number) => {
    queryClient.setQueriesData<Pages>({ queryKey: recordingKeys.all }, (old) =>
      old && old.pages.some((p) => p.items.some((i) => i.id === id)) ? patchPages(old, (items) => items.filter((i) => i.id !== id), -1) : old,
    );
  }, []);

  return {
    ...data,
    loading,
    loadingMore,
    error,
    loadMore,
    reload,
    replaceItem,
    removeItem,
  };
}
