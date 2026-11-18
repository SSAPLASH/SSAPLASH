// 반주 선택 창 목록 훅 (설계 MODE-002 3-8, D7·D12). 전역 songStore를 쓰지 않고 listSongs를 직접 부른다.
// 두 섹션(공용 곡·내 곡)을 같은 검색어로 따로 받고, 반주 없는 곡은 한 번 더 거른다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { listSongs } from '@/api/song/songs';
import { pickableForAccompaniment } from '@/domain/song/freeAccompaniment';
import type { SongPage, SongScope, SongSummary } from '@/domain/song/songCatalog';

/** 섹션 한 페이지 크기 */
export const PAGE_SIZE = 30;
/** 거른 뒤 비면 이어 받는 최대 페이지 수(D12) */
export const MAX_FILL_PAGES = 3;
export const SEARCH_DEBOUNCE_MS = 300;
export const QUERY_MAX = 100;

export type SectionKey = 'builtin' | 'mine';
const SCOPE: Record<SectionKey, SongScope> = { builtin: 'BUILTIN', mine: 'MINE' };
const KEYS: SectionKey[] = ['builtin', 'mine'];

export interface SongSection {
  items: SongSummary[];
  status: 'loading' | 'ready' | 'error';
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

export interface UseAccompanimentSongs {
  query: string;
  setQuery: (q: string) => void;
  sections: Record<SectionKey, SongSection>;
}

export interface AccompanimentSongsDeps {
  listSongs?: (params: Parameters<typeof listSongs>[0], signal?: AbortSignal) => Promise<SongPage>;
}

interface SectionState {
  items: SongSummary[];
  status: 'loading' | 'ready' | 'error';
  hasMore: boolean;
  /** 다음에 받을 페이지(0부터) */
  nextPage: number;
}
const INITIAL: SectionState = { items: [], status: 'loading', hasMore: false, nextPage: 0 };

export function useAccompanimentSongs(deps: AccompanimentSongsDeps = {}): UseAccompanimentSongs {
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const [query, setQueryState] = useState('');
  const [debounced, setDebounced] = useState('');
  const [state, setState] = useState<Record<SectionKey, SectionState>>({ builtin: INITIAL, mine: INITIAL });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  /** 섹션별 진행 중 요청. 검색어가 바뀌거나 창이 닫히면 모두 취소한다 */
  const ctlRef = useRef<Record<SectionKey, AbortController | null>>({ builtin: null, mine: null });
  const debouncedRef = useRef(debounced);
  useEffect(() => {
    debouncedRef.current = debounced;
  });

  const setQuery = useCallback((q: string) => setQueryState(q.slice(0, QUERY_MAX)), []);

  // 검색어 300ms 디바운스(앞뒤 공백 제거)
  useEffect(() => {
    const next = query.trim();
    if (next === debouncedRef.current) return;
    const id = setTimeout(() => setDebounced(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  /** 섹션 하나를 startPage부터 받는다. 거른 뒤 비었고 hasNext면 이어 받는다(최대 MAX_FILL_PAGES) */
  const fetchSection = useCallback((key: SectionKey, q: string, startPage: number, append: boolean) => {
    ctlRef.current[key]?.abort();
    const ctl = new AbortController();
    ctlRef.current[key] = ctl;
    setState((s) => ({ ...s, [key]: { ...(append ? s[key] : INITIAL), status: 'loading' } }));
    void (async () => {
      const list = depsRef.current.listSongs ?? listSongs;
      try {
        let page = startPage;
        let picked: SongSummary[] = [];
        let hasNext = false;
        for (let i = 0; i < MAX_FILL_PAGES; i++) {
          const res = await list({ source: SCOPE[key], q: q || undefined, page, size: PAGE_SIZE, withAccompaniment: true }, ctl.signal);
          if (ctl.signal.aborted) return;
          picked = res.items.filter((song) => pickableForAccompaniment(song) !== 'hidden');
          hasNext = res.hasNext;
          page += 1;
          if (picked.length > 0 || !hasNext) break;
        }
        setState((s) => {
          const prev = append ? s[key].items : [];
          const seen = new Set(prev.map((x) => x.id));
          const items = [...prev, ...picked.filter((x) => !seen.has(x.id))];
          return { ...s, [key]: { items, status: 'ready', hasMore: hasNext, nextPage: page } };
        });
      } catch {
        if (ctl.signal.aborted) return;
        setState((s) => ({ ...s, [key]: { ...s[key], status: 'error' } }));
      }
    })();
  }, []);

  // 검색어가 정해지면 두 섹션을 1페이지부터 다시 받는다. 정리 때 진행 중 요청을 취소한다
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 검색어 변경 때 목록을 비우고 로딩 표시를 켜는 일이 요청 시작·이전 요청 취소(AbortController)와 한 묶음이라 effect에서 불러야 한다
    for (const key of KEYS) fetchSection(key, debounced, 0, false);
    const ctls = ctlRef.current;
    return () => {
      for (const key of KEYS) {
        ctls[key]?.abort();
        ctls[key] = null;
      }
    };
  }, [debounced, fetchSection]);

  const section = (key: SectionKey): SongSection => ({
    items: state[key].items,
    status: state[key].status,
    hasMore: state[key].hasMore,
    loadMore: () => {
      const cur = stateRef.current[key];
      if (cur.status === 'loading' || !cur.hasMore) return;
      fetchSection(key, debouncedRef.current, cur.nextPage, true);
    },
    retry: () => {
      const cur = stateRef.current[key];
      // 이어 받기 실패면 그 페이지부터, 첫 페이지 실패면 처음부터
      fetchSection(key, debouncedRef.current, cur.nextPage, cur.items.length > 0 || cur.nextPage > 0);
    },
  });

  return { query, setQuery, sections: { builtin: section('builtin'), mine: section('mine') } };
}
