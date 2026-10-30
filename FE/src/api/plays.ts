// 플레이 로그 요약 업로드 (ACCT-002 v1, BE 98). 본문 조립은 domain/playUpload.
import type { PlayUploadBody } from '@/domain/playUpload';
import { apiFetch } from './http';

export interface PlayUploadResponse {
  playId: string;
  /** 원본 업로드 상태. 리포트 준비 여부와 무관하다(회신 2 §2) */
  rawLogStatus: 'PENDING' | 'UPLOADED';
}

/** `POST /api/v1/plays` — 신규 201, 같은 본문 재전송 200. 둘 다 성공으로 본다 */
export function uploadPlay(body: PlayUploadBody, signal?: AbortSignal): Promise<PlayUploadResponse> {
  return apiFetch<PlayUploadResponse>('/api/v1/plays', { method: 'POST', body, signal });
}
