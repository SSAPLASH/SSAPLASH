// 연주 중 LLM 구간 코칭 API (COACH-001, BE `/api/v1/live-coach/segments`). 로그인 사용자만 쓴다.
// 구간 사실을 넣으면 요청 번호를 받고(꺼져 있으면 204 → null), 결과를 짧은 주기로 조회한다.
import type { LlmCoachClient } from '@/coach/live/llmCoach';
import type { SegmentFacts } from '@/coach/live/segment';
import { ApiError, apiFetch } from '@/api/http';

export interface LiveCoachRequest {
  requestId: string;
  expiresAt: string;
}

/** 대기 중이면 status만, 완료면 문구까지 */
export interface LiveCoachResult {
  status: 'QUEUED' | 'RUNNING' | 'DONE';
  title?: string;
  sub?: string;
  model?: string;
  generationMs?: number;
}

/** 꺼져 있으면(204) null. 상한 초과는 429 ApiError, 그 밖의 실패도 ApiError */
export async function requestLiveCoach(runId: string, facts: SegmentFacts, signal?: AbortSignal): Promise<LiveCoachRequest | null> {
  const res = await apiFetch<LiveCoachRequest | undefined>('/api/v1/live-coach/segments', {
    method: 'POST',
    body: { runId, facts },
    signal,
    // 연주 중 요청이라 401 뒤 재전송하지 않는다(그 구간은 규칙 코칭만)
    noRetryOn401: true,
  });
  return res && typeof res.requestId === 'string' ? res : null;
}

/** 실패·만료는 410 ApiError, 남의 요청·없음은 404 ApiError */
export function pollLiveCoach(requestId: string, signal?: AbortSignal): Promise<LiveCoachResult> {
  return apiFetch<LiveCoachResult>(`/api/v1/live-coach/segments/${encodeURIComponent(requestId)}`, { signal, noRetryOn401: true });
}

/** LlmCoach에 넘기는 BE 어댑터. 429는 'limit', 410은 gone, 대기 중은 pending으로 바꾼다 */
export function liveCoachClient(): LlmCoachClient {
  return {
    async request(runId, facts) {
      try {
        const r = await requestLiveCoach(runId, facts);
        return r ? { requestId: r.requestId } : null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) return 'limit';
        throw e;
      }
    },
    async poll(requestId) {
      try {
        const r = await pollLiveCoach(requestId);
        if (r.status !== 'DONE' || !r.title) return { kind: 'pending' };
        return { kind: 'done', title: r.title, sub: r.sub ?? '', model: r.model ?? '', generationMs: r.generationMs ?? 0 };
      } catch (e) {
        if (e instanceof ApiError && (e.status === 410 || e.status === 404)) return { kind: 'gone' };
        throw e;
      }
    },
  };
}
