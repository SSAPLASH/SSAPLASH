// 스틱 재연결 모듈 (설계 U21). 상태(idle·trying·failed)와 [다시 연결] 액션을 한곳에 둔다. 영속하지 않는다.
// 실제 연결 동작은 앱 조립 쪽(app/bootstrap)이 setReconnectHandler로 끼운다 — 이 스토어는 소스 종류를 모른다.
// 자동 재시도(3회)·EMB 신호 연동은 Sprint 4 EMB-FE에서 attempt·max를 채운다.
import { create } from 'zustand';

/** 재연결 동작. 연결에 실패하면 거부(throw)해야 한다 */
export type ReconnectHandler = () => Promise<void>;

export type ReconnectStatus = 'idle' | 'trying' | 'failed';

interface ReconnectState {
  status: ReconnectStatus;
  /** 지금 몇 번째 시도인지(1부터). idle이면 0 */
  attempt: number;
  /** 최대 시도 횟수 */
  max: number;
  /** 핸들러가 등록돼 있는지. 아니면 [다시 연결]을 숨긴다 */
  available: boolean;

  /** 핸들러가 없으면 아무것도 안 한다. 시도 중이면 중복 호출을 무시한다 */
  reconnect: () => Promise<void>;
}

const MAX_ATTEMPTS = 3;

let handler: ReconnectHandler | null = null;

export const useReconnect = create<ReconnectState>()((set, get) => ({
  status: 'idle',
  attempt: 0,
  max: MAX_ATTEMPTS,
  available: false,

  reconnect: async () => {
    const run = handler;
    if (!run || get().status === 'trying') return;
    set({ status: 'trying', attempt: 1 });
    try {
      await run();
      set({ status: 'idle', attempt: 0 });
    } catch {
      set({ status: 'failed' });
    }
  },
}));

/** 재연결 동작을 등록한다. null이면 해제(연결 개념이 없는 소스). 상태도 처음으로 되돌린다 */
export function setReconnectHandler(next: ReconnectHandler | null): void {
  handler = next;
  useReconnect.setState({ available: next !== null, status: 'idle', attempt: 0 });
}
