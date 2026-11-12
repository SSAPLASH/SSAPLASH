// 플레이 로그 요약 업로드 (ACCT-002 v1, BE 98). 본문 조립은 domain/play/playUpload.
import type { PlayUploadBody } from '@/domain/play/playUpload';
import { apiFetch } from './http';
import type { PageResponse } from './recordings';

export interface BestRecordDto {
  songId: number;
  chartId: number;
  difficulty: 'EASY' | 'NORMAL' | 'HARD';
  mode: 'RHYTHM' | 'SHEET';
  bestScore: number | null;
  /** 서버 백분율(0~100). 화면 비율로의 변환은 domain/serverBestRecord가 맡는다. */
  bestAccuracy: number | null;
}

export interface BestRecordsResponse { items: BestRecordDto[] }

export function getBestRecords(songIds: readonly number[], signal: AbortSignal): Promise<BestRecordsResponse> {
  if (songIds.length < 1 || songIds.length > 100 || songIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return Promise.reject(new Error('최고 기록 조회에는 유효한 곡 ID 1~100개가 필요합니다.'));
  }
  return apiFetch<BestRecordsResponse>(`/api/v1/plays/best-records?songIds=${songIds.join(',')}`, { signal });
}

export interface PlaySummary {
  playId: string;
  startedAt: string;
  endedAt: string;
  mode: string;
  inputSource: string;
  songId: number | null;
  songTitle: string | null;
  chartVersionId: number | null;
  chartId: number | null;
  difficulty: string | null;
  endReason: string | null;
  songAccessible: boolean;
  score: number | null;
  accuracy: number | null;
  maxCombo: number | null;
  hasReport: boolean;
}

/** 필터와 정렬이 클라이언트에서 전체 기록에 적용되도록 모든 페이지를 읽는다. */
export async function listAllPlays(signal: AbortSignal): Promise<PlaySummary[]> {
  const plays = new Map<string, PlaySummary>();
  for (let page = 0; page <= 100000; page += 1) {
    const result = await apiFetch<PageResponse<PlaySummary>>(`/api/v1/plays?page=${page}&size=100`, { signal });
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    for (const play of result.items) if (!plays.has(play.playId)) plays.set(play.playId, play);
    if (!result.hasNext) return [...plays.values()];
    if (result.items.length === 0) throw new Error('Invalid play page');
  }
  throw new Error('Too many play pages');
}

export interface PlayUploadResponse {
  playId: string;
  /** 원본 업로드 상태. 리포트 준비 여부와 무관하다(회신 2 §2) */
  rawLogStatus: 'PENDING' | 'UPLOADED';
}

/** `POST /api/v1/plays` — 신규 201, 같은 본문 재전송 200. 둘 다 성공으로 본다 */
export function uploadPlay(body: PlayUploadBody, signal?: AbortSignal): Promise<PlayUploadResponse> {
  return apiFetch<PlayUploadResponse>('/api/v1/plays', { method: 'POST', body, signal });
}
