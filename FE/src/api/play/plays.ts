// 플레이 로그 요약 업로드 (ACCT-002 v1, BE 98). 본문 조립은 domain/play/playUpload.
import type { PlayUploadBody } from '@/domain/play/playUpload';
import { apiFetch } from '@/api/http';
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
  /** 연주 배율(연습 속도). 배율이 없던 옛 기록은 1. 이 필드가 생기기 전 서버 응답에는 없다 */
  playbackRate?: number;
}

/** `GET /api/v1/plays` 조건(BE 309). 서버가 검색·기간·모드·정렬을 처리한다 */
export interface ListPlaysParams {
  /** 곡 제목 부분 검색(접근할 수 있는 곡 제목만 대상) */
  q?: string;
  /** 종료일 범위, 한국 시간, 양 끝 포함(`YYYY-MM-DD`) */
  from?: string;
  to?: string;
  /** 생략하면 전체 */
  mode?: 'FREE' | 'RHYTHM' | 'SHEET' | 'TEMPO';
  /** 종료 시각 기준. 생략하면 NEWEST */
  sort?: 'NEWEST' | 'OLDEST';
  page?: number;
  size?: number;
}

/** `GET /api/v1/plays` — 본인 연주 기록 한 쪽. 값이 없는 쿼리는 넣지 않는다 */
export function listPlays(params: ListPlaysParams = {}, signal?: AbortSignal): Promise<PageResponse<PlaySummary>> {
  const qs = new URLSearchParams();
  const q = params.q?.trim();
  if (q) qs.set('q', q);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.mode) qs.set('mode', params.mode);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.size !== undefined) qs.set('size', String(params.size));
  const query = qs.toString();
  return apiFetch<PageResponse<PlaySummary>>(query ? `/api/v1/plays?${query}` : '/api/v1/plays', { signal });
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
