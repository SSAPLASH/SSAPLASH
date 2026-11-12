// 공통 조회 훅 (설계 TECH-350 3절). useQuery 결과를 화면이 쓰던 상태명(loading/ready/error)과 오류 문장으로 바꾼다.
import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { ApiError } from '@/api/http';
import { queryClient } from '@/runtime/queryClient';

export type ApiQueryStatus = 'loading' | 'ready' | 'error';

export interface ApiQueryResult<T> {
  /** 마지막 성공 데이터. 조건만 바뀐 동안에는 이전 데이터가 남는다(placeholder) */
  data: T | undefined;
  status: ApiQueryStatus;
  /** ApiError면 BE detail, 그 밖은 오류 메시지. 오류가 없으면 null */
  error: string | null;
  /** 지금 데이터가 이전 조건의 데이터(placeholder)인지 */
  isPlaceholder: boolean;
  refetch: () => void;
}

/** 오류를 화면에 보일 문장으로. ApiError는 BE가 준 한국어 detail 그대로 */
export function queryErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof Error && e.message) return e.message;
  return '알 수 없는 오류가 발생했습니다.';
}

export function useApiQuery<T, K extends QueryKey = QueryKey>(options: UseQueryOptions<T, Error, T, K>): ApiQueryResult<T> {
  // 앱 캐시 인스턴스를 직접 쓴다. store의 무효화·부분 갱신과 같은 캐시를 보고, 테스트에서 Provider로 감싸지 않아도 된다
  const q = useQuery(options, queryClient);
  // 비활성(enabled=false)이고 데이터가 없으면 아직 읽기 전이므로 loading으로 본다
  const status: ApiQueryStatus = q.isError ? 'error' : q.data !== undefined ? 'ready' : 'loading';
  return {
    data: q.data,
    status,
    error: q.isError ? queryErrorMessage(q.error) : null,
    isPlaceholder: q.isPlaceholderData,
    refetch: () => void q.refetch(),
  };
}
