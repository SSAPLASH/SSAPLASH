// 플레이 기록 서버 목록 조회 훅 (설계 COACH-연주-기록-화면-개편 3-1·4). 녹음 목록(useRecordingList)과 같은 모양이다.
// 모드·기간·정렬·검색어가 바뀌면 page 0부터 다시 조회하고, [더 보기]는 다음 쪽을 이어 붙인다. 검색어는 300ms 디바운스.
// 검색·기간·모드·정렬은 서버(BE 309)가 처리한다. 목록은 서버 데이터 캐시(쪽 단위 쿼리)가 갖고, 키에 사용자 id를 넣는다(TECH-351).
// 조회 로직의 순수 부분(buildPlayParams·appendPlayPage)은 따로 export해 테스트한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ListPlaysParams, PlaySummary } from '@/api/play/plays';
import { PLAY_PAGE_SIZE, playPageQuery } from '@/api/play/playQueries';
import type { PageResponse } from '@/api/play/recordings';
import { periodRange, type HistoryFilter, type HistoryPeriod, type PlayLogSort } from '@/domain/play/playLogView';
import { queryClient } from '@/runtime/queryClient';
import { listErrorMessage, SEARCH_DEBOUNCE_MS } from './useRecordingList';

export interface PlayLogQuery {
  mode: HistoryFilter;
  period: HistoryPeriod;
  sort: PlayLogSort;
  q: string;
}

/** 누적된 서버 목록 */
export interface PlayListData {
  items: PlaySummary[];
  /** 조건에 맞는 서버 전체 건수 */
  total: number;
  hasNext: boolean;
}

export const PLAY_LIST_EMPTY: PlayListData = { items: [], total: 0, hasNext: false };

/** 조회 조건 → API 쿼리. 빈 검색어·전체 모드·전체 기간은 생략한다. 기간은 한국 시간 날짜로 바꾼다 */
export function buildPlayParams(query: PlayLogQuery, now: Date, page = 0): ListPlaysParams {
  const q = query.q.trim();
  const range = periodRange(query.period, now);
  return {
    q: q || undefined,
    from: range.from,
    to: range.to,
    mode: query.mode === 'ALL' ? undefined : query.mode,
    sort: query.sort,
    page,
    size: PLAY_PAGE_SIZE,
  };
}

/** 응답 병합. page 0이면 교체, 아니면 이어 붙인다(앞쪽에 새 기록이 생겨 밀린 중복 playId는 건너뜀) */
export function appendPlayPage(prev: PlayListData, res: PageResponse<PlaySummary>): PlayListData {
  let items: PlaySummary[];
  if (res.page === 0) {
    items = res.items;
  } else {
    const seen = new Set(prev.items.map((p) => p.playId));
    items = [...prev.items, ...res.items.filter((p) => !seen.has(p.playId))];
  }
  return { items, total: res.totalElements, hasNext: res.hasNext };
}

export interface UsePlayLogList extends PlayListData {
  /** 첫 쪽(조건 변경·다시 불러오기) 조회 중. 로그인 사용자가 없으면 false */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** 서버에 보낸 검색어(디바운스 반영). 서버에 없는 기록에도 같은 검색어를 쓴다 */
  appliedQ: string;
  loadMore: () => void;
  /** page 0 재조회 */
  reload: () => void;
}

/**
 * `userId`가 null이면(로그인 없는 빌드·로그인 전) 서버를 부르지 않는다.
 * `now`는 기간 계산의 기준 시각이다. 화면이 조건을 바꿀 때 새로 넘기면 자정을 넘겨도 범위가 맞는다(생략하면 훅이 처음 만들어진 시각).
 */
export function usePlayLogList(userId: number | null, { mode, period, sort, q }: PlayLogQuery, now?: Date): UsePlayLogList {
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [mountedAt] = useState(() => new Date());

  // 검색어만 300ms 디바운스(모드·기간·정렬은 즉시)
  useEffect(() => {
    if (q === debouncedQ) return;
    const t = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, debouncedQ]);

  // 기간은 날짜 문자열로 키에 들어간다
  const { page: _page, ...keyParams } = buildPlayParams({ mode, period, sort, q: debouncedQ }, now ?? mountedAt, 0);
  const enabled = userId != null;
  const options = playPageQuery(userId ?? 0, keyParams);
  const query = useInfiniteQuery({ ...options, enabled }, queryClient);

  const data = useMemo(() => (query.data ? query.data.pages.reduce(appendPlayPage, PLAY_LIST_EMPTY) : PLAY_LIST_EMPTY), [query.data]);
  const loading = enabled && query.isPending;
  const loadingMore = query.isFetchingNextPage;
  const error = query.isError ? listErrorMessage(query.error) : null;

  const { hasNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (!hasNextPage || loadingMore || loading) return;
    void fetchNextPage();
  }, [hasNextPage, loadingMore, loading, fetchNextPage]);

  // page 0부터 다시(이어 받은 쪽은 버린다)
  const keyJson = JSON.stringify(options.queryKey);
  const reload = useCallback(() => {
    void queryClient.resetQueries({ queryKey: JSON.parse(keyJson), exact: true });
  }, [keyJson]);

  return { ...data, loading, loadingMore, error, appliedQ: debouncedQ, loadMore, reload };
}
