// 연주 목록 쿼리 (설계 TECH-351). 연주 업로드가 끝나면(playSync DONE) ['plays']를 무효화한다.
import { queryOptions } from '@tanstack/react-query';
import { listAllPlays, type PlaySummary } from '../plays';

export const playKeys = {
  all: ['plays'] as const,
  /** 사용자 id를 키에 넣어, 계정이 바뀐 뒤 늦게 도착한 이전 계정 응답이 새 계정 화면에 섞이지 않게 한다 */
  list: (userId: number) => ['plays', 'list', userId] as const,
};

export function playListQuery(userId: number) {
  return queryOptions<PlaySummary[]>({
    queryKey: playKeys.list(userId),
    queryFn: ({ signal }) => listAllPlays(signal),
  });
}
