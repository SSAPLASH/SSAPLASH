// 녹음 업로드 실행 (설계 REC-001 2절·3-5·3-6). 503 자동 재시도, 오류 → 사용자 문구, 게임·악보 playId 결정을 맡는다.
// 본문 조립은 domain/play/recording, 상태 보관은 runtime/recordingStore가 한다.
import { ApiError } from '@/api/error';
import { saveRecording } from '@/api/play/recordings';
import { recordingKeys } from '@/api/play/recordingQueries';
import { queryClient } from './queryClient';
import type { RecordingBody, RecordingSummary } from '@/domain/play/recording';
import { startPlaySync } from './playSync';

/** 503 자동 재시도 횟수와 기본 대기(1·2·4초) */
export const RECORDING_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

export type RecordingErrorKind = 'retry' | 'auth' | 'conflict' | 'quota' | 'tooLarge' | 'invalid';

export interface RecordingErrorInfo {
  /** 사용자에게 보여 줄 문구 */
  message: string;
  /** [다시 시도]를 보일지 */
  retryable: boolean;
  kind: RecordingErrorKind;
}

export interface UploadOptions {
  /** 재시도 대기. 테스트에서 즉시 대기로 바꾼다 */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 게임·악보 녹음에 실을 playId 결정 (3-5). 플레이 로그 업로드가 DONE이면 그 playId, 그 밖(SKIPPED·FAILED·null·예외)이면 undefined.
 * 진행 중이면 같은 Promise를 기다린다.
 */
export async function resolvePlayId(playId: string): Promise<string | undefined> {
  try {
    const st = await startPlaySync(playId);
    return st?.status === 'DONE' ? playId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 녹음 전송. 503은 같은 본문으로 최대 3회 다시 보낸다(대기 1·2·4초, `retryAfterMs`가 있으면 그 값).
 * 그 밖의 오류와 재시도 소진 뒤 오류는 그대로 던진다.
 */
export async function uploadRecording(body: RecordingBody, opts: UploadOptions = {}): Promise<RecordingSummary> {
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      const saved = await saveRecording(body, opts.signal);
      // 녹음 보관함 목록 캐시를 새로 받게 한다(설계 TECH-351)
      void queryClient.invalidateQueries({ queryKey: recordingKeys.all });
      return saved;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 503 || attempt >= RECORDING_RETRY_DELAYS_MS.length) throw e;
      await sleep(e.retryAfterMs ?? RECORDING_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** 오류 → 문구·재시도 가능 여부 (3-6 표). ApiError가 아니면 네트워크 실패와 같게 본다 */
export function describeRecordingError(e: unknown): RecordingErrorInfo {
  const unstable: RecordingErrorInfo = { message: '연결이 불안정해요. 다시 시도해 주세요.', retryable: true, kind: 'retry' };
  if (!(e instanceof ApiError)) return unstable;
  if (e.status === 401) return { message: '로그인이 필요해요. 로그인한 뒤 다시 시도해 주세요.', retryable: true, kind: 'auth' };
  if (e.status === 0 || e.status >= 500) return unstable;
  if (e.status === 409) {
    console.warn('녹음 저장 충돌(같은 clientKey에 다른 본문)', e.code, e.detail);
    return { message: '저장 중 문제가 생겼어요.', retryable: false, kind: 'conflict' };
  }
  if (e.status === 413) {
    if (e.code === 'RECORDING_QUOTA_EXCEEDED') return { message: '녹음 보관함이 가득 찼어요(200개).', retryable: false, kind: 'quota' };
    // RECORDING_TOO_LARGE 또는 Nginx가 돌려준 코드 없는(HTTP_ERROR) 413
    return { message: '녹음이 너무 길어 저장하지 못했어요.', retryable: false, kind: 'tooLarge' };
  }
  // 400·404 등 그 밖의 4xx: BE가 준 문장을 보여 준다
  return { message: e.code !== 'HTTP_ERROR' && e.detail ? e.detail : '녹음을 저장하지 못했어요.', retryable: false, kind: 'invalid' };
}
