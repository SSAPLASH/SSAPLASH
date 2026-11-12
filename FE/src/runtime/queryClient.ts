// 서버 데이터 캐시 공통 정책 (설계 TECH-350 3절). 화면별 키·조회 함수는 api/queries가 정한다.
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/http';

/** 목록을 다시 받지 않고 쓰는 시간(U1). 내 곡이 바뀌면 무효화로 바로 갱신한다 */
export const DEFAULT_STALE_MS = 30_000;
/** 화면에서 쓰지 않는 캐시를 보관하는 시간 */
export const DEFAULT_GC_MS = 5 * 60_000;

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * 네트워크 오류(status 0)·5xx만 1회 재시도한다. 4xx는 다시 보내도 같은 결과이고,
 * 401은 apiFetch가 이미 refresh 뒤 재시도한다. 취소는 재시도하지 않는다.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (isAbort(error)) return false;
  if (error instanceof ApiError) {
    // apiFetch는 취소도 status 0(NETWORK)으로 감싸므로 원인을 한 번 더 본다
    if (error.status === 0) return !isAbort(error.cause);
    return error.status >= 500;
  }
  return false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: 1000,
        staleTime: DEFAULT_STALE_MS,
        gcTime: DEFAULT_GC_MS,
        // 연주 중 탭을 오가도 요청·렌더가 끼지 않게 한다
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: { retry: 0 },
    },
  });
}

/** 앱 전체가 쓰는 캐시. store(무효화·부분 갱신)와 main.tsx(공급)가 같은 인스턴스를 본다 */
export const queryClient = createQueryClient();
