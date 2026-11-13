// 연주 기록 쪽 단위 목록 쿼리 (설계 TECH-351, COACH-연주-기록-화면-개편). 연주 업로드가 끝나면(playSync DONE) ['plays']를 무효화한다.
import { infiniteQueryOptions } from '@tanstack/react-query';
import { listPlays, type ListPlaysParams, type PlaySummary } from './plays';
import type { PageResponse } from './recordings';

/** 키에 넣는 조회 조건(쪽 번호 제외) */
export type PlayListKeyParams = Omit<ListPlaysParams, 'page'>;

export const PLAY_PAGE_SIZE = 20;

/** 연주 기록 화면이 처음 읽는 조건. 메뉴 미리 받기(app/prefetchRoute)가 같은 키로 첫 쪽을 받아 둔다 */
export const DEFAULT_PLAY_LIST: PlayListKeyParams = { sort: 'NEWEST', size: PLAY_PAGE_SIZE };

export const playKeys = {
  all: ['plays'] as const,
  /** 사용자 id를 키에 넣어, 계정이 바뀐 뒤 늦게 도착한 이전 계정 응답이 새 계정 화면에 섞이지 않게 한다 */
  list: (userId: number, p: PlayListKeyParams) =>
    ['plays', 'list', userId, { q: p.q ?? '', from: p.from ?? null, to: p.to ?? null, mode: p.mode ?? null, sort: p.sort ?? null, size: p.size ?? null }] as const,
};

export function playPageQuery(userId: number, p: PlayListKeyParams) {
  return infiniteQueryOptions<PageResponse<PlaySummary>, Error, { pages: PageResponse<PlaySummary>[] }, ReturnType<typeof playKeys.list>, number>({
    queryKey: playKeys.list(userId, p),
    queryFn: ({ pageParam, signal }) => listPlays({ ...p, page: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
  });
}
