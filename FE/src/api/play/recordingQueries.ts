// 녹음 보관함 쪽 단위 목록 쿼리 (설계 TECH-351). 녹음 업로드가 성공하면 ['recordings']를 무효화한다.
// 503은 공통 정책(5xx 1초 뒤 1회 재시도)이 맡는다.
import { infiniteQueryOptions } from '@tanstack/react-query';
import type { RecordingSummary } from '@/domain/play/recording';
import { listRecordings, type ListRecordingsParams, type PageResponse } from './recordings';

/** 키에 넣는 조회 조건(쪽 번호 제외) */
export type RecordingListKeyParams = Omit<ListRecordingsParams, 'page'>;

export const recordingKeys = {
  all: ['recordings'] as const,
  list: (p: RecordingListKeyParams) => ['recordings', 'list', { q: p.q ?? '', mode: p.mode ?? null, sort: p.sort ?? null, size: p.size ?? null }] as const,
};

export function recordingListQuery(p: RecordingListKeyParams) {
  return infiniteQueryOptions<PageResponse<RecordingSummary>, Error, { pages: PageResponse<RecordingSummary>[] }, ReturnType<typeof recordingKeys.list>, number>({
    queryKey: recordingKeys.list(p),
    queryFn: ({ pageParam, signal }) => listRecordings({ ...p, page: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
  });
}
