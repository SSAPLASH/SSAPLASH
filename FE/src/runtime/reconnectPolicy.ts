// 재연결 조립에서 쓰는 순수 판단 함수 모음(설계 PLAY-002 4-1·4-2, D1·D5). bootstrap의 부작용과 분리해 단위 테스트한다.
import type { InputSourceKind } from '@/domain/events';

/** 시도 하나가 손 복귀를 기다리는 최대 시간 (D1) */
export const RECONNECT_WAIT_MS = 3000;
/** 비트 5(설정 전) 재전송 최소 간격 (D5) */
export const RESEND_COOLDOWN_MS = 1000;

/** 3회 실패 때 화면이 보일 소스별 안내 문구 (설계 3-6) */
export function hintFor(kind: InputSourceKind): string {
  switch (kind) {
    case 'webserial':
      return '동글을 뺐다 다시 꽂아 주세요';
    case 'ble':
      return '스틱 버튼을 눌러 켜 주세요';
    case 'websocket':
      return '브리지가 켜져 있는지 확인해 주세요';
    default:
      return '';
  }
}

/** 직전 재전송 시각(없으면 null)에서 쿨다운이 지났으면 true */
export function shouldResend(lastAt: number | null, now: number, cooldownMs = RESEND_COOLDOWN_MS): boolean {
  return lastAt === null || now - lastAt >= cooldownMs;
}

/**
 * 필요한 기기(손 둘 + 발 둘, 네 칸)가 모두 연결될 때까지 기다린다. 이미 연결돼 있으면 즉시 resolve.
 * 시간이 지나거나 signal이 취소되면 구독을 풀고 reject한다.
 */
export function waitForDevices(
  getConnected: () => readonly boolean[],
  subscribe: (listener: () => void) => () => void,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  const ready = () => {
    const c = getConnected();
    return c.length > 0 && c.every((v) => v === true);
  };
  if (signal.aborted) return Promise.reject(new Error('취소됨'));
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = (err?: Error) => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => finish(new Error('취소됨'));
    const timer = setTimeout(() => finish(new Error('기기가 돌아오지 않았습니다')), timeoutMs);
    const unsubscribe = subscribe(() => {
      if (ready()) finish();
    });
    signal.addEventListener('abort', onAbort);
  });
}
