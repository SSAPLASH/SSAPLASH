// 녹음 제목 변경·삭제 요청의 공통 처리 (설계 REC-001 3-8): 503 1회 재시도와 오류 분류. 순수 함수라 sleep을 주입해 테스트한다.
import { ApiError } from '@/api/error';

export const MUTATION_RETRY_MS = 1000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** fn이 503(ApiError)으로 실패하면 `retryAfterMs ?? 1000`ms 뒤 한 번만 다시 호출한다. 두 번째 실패는 그대로 던진다 */
export async function runWithRetry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) {
      await sleep(e.retryAfterMs ?? MUTATION_RETRY_MS);
      return fn();
    }
    throw e;
  }
}

export interface MutationErrorInfo {
  /** missing: 404 RECORDING_NOT_FOUND, invalid: 400 RECORDING_INVALID, other: 그 밖 */
  kind: 'missing' | 'invalid' | 'other';
  /** ApiError면 서버 detail, 아니면 빈 문자열 */
  detail: string;
}

export function classifyMutationError(e: unknown): MutationErrorInfo {
  if (!(e instanceof ApiError)) return { kind: 'other', detail: '' };
  if (e.status === 404 && e.code === 'RECORDING_NOT_FOUND') return { kind: 'missing', detail: e.detail };
  if (e.status === 400 && e.code === 'RECORDING_INVALID') return { kind: 'invalid', detail: e.detail };
  return { kind: 'other', detail: e.detail };
}
