// 녹음 보관함 목록 조회 훅 (설계 REC-001 3-8·6-2). 모드·정렬·검색어가 바뀌면 page 0부터 다시 조회하고,
// [더 보기]는 page + 1을 이어 붙인다. 검색어는 300ms 디바운스, 진행 중 요청은 AbortController로 끊고 끊긴 응답은 버린다.
// 503은 1초 뒤 1회 자동 재시도한다. 조회 로직의 순수 부분(buildListParams·appendPage·listErrorMessage)은 따로 export해 테스트한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/error';
import { listRecordings, type ListRecordingsParams, type PageResponse } from '@/api/recordings';
import type { RecordingMode, RecordingSort, RecordingSummary } from '@/domain/recording';

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

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** signal이 끊기면 즉시 풀리는 대기. 끊겼으면 AbortError를 던진다 */
function waitOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 503이면 1초 뒤 한 번만 다시 시도한다 */
async function fetchPage(params: ListRecordingsParams, signal: AbortSignal): Promise<PageResponse<RecordingSummary>> {
  try {
    return await listRecordings(params, signal);
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) {
      await waitOrAbort(BUSY_RETRY_MS, signal);
      return listRecordings(params, signal);
    }
    throw e;
  }
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

/** 조회 결과. key는 어떤 조건(모드·정렬·검색어·재조회 횟수)의 결과인지 */
interface Loaded extends RecordingListData {
  key: string;
  error: string | null;
  loadingMore: boolean;
}

export function useRecordingList({ mode, sort, q }: RecordingListQuery): UseRecordingList {
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Loaded | null>(null);
  const pageRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const key = `${mode}|${sort}|${debouncedQ}|${tick}`;
  // 현재 조건의 결과가 아직 없으면 첫 조회 중이다(상태를 effect에서 동기로 초기화하지 않고 key 비교로 파생)
  const current = state !== null && state.key === key ? state : null;
  const data = current ?? EMPTY;

  // 검색어만 300ms 디바운스(모드·정렬은 즉시)
  useEffect(() => {
    if (q === debouncedQ) return;
    const t = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, debouncedQ]);

  // 조건이 바뀌거나 reload()하면 page 0부터 다시. 이전 요청은 끊고 끊긴 응답은 버린다
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    pageRef.current = 0;
    fetchPage(buildListParams({ mode, sort, q: debouncedQ }, 0), controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setState({ key, ...appendPage(EMPTY, res), error: null, loadingMore: false });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || isAbort(e)) return;
        setState({ key, ...EMPTY, error: listErrorMessage(e), loadingMore: false });
      });
    return () => controller.abort();
  }, [mode, sort, debouncedQ, key]);

  const hasNext = data.hasNext;
  const loadingMore = current?.loadingMore ?? false;
  const loadMore = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted || !hasNext || loadingMore) return;
    const page = pageRef.current + 1;
    setState((prev) => (prev && prev.key === key ? { ...prev, loadingMore: true } : prev));
    fetchPage(buildListParams({ mode, sort, q: debouncedQ }, page), controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        pageRef.current = page;
        setState((prev) => (prev && prev.key === key ? { key, ...appendPage(prev, res), error: null, loadingMore: false } : prev));
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || isAbort(e)) return;
        const message = listErrorMessage(e);
        setState((prev) => (prev && prev.key === key ? { ...prev, error: message, loadingMore: false } : prev));
      });
  }, [mode, sort, debouncedQ, key, hasNext, loadingMore]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const replaceItem = useCallback((summary: RecordingSummary) => {
    setState((prev) => (prev ? { ...prev, items: prev.items.map((i) => (i.id === summary.id ? summary : i)) } : prev));
  }, []);

  const removeItem = useCallback((id: number) => {
    setState((prev) => {
      if (!prev || !prev.items.some((i) => i.id === id)) return prev;
      return { ...prev, items: prev.items.filter((i) => i.id !== id), total: Math.max(0, prev.total - 1) };
    });
  }, []);

  return {
    ...data,
    loading: current === null,
    loadingMore,
    error: current?.error ?? null,
    loadMore,
    reload,
    replaceItem,
    removeItem,
  };
}
