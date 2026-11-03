// 스틱 재연결 모듈 (설계 PLAY-002 3-6·4-3). 상태(idle·trying·failed·reconnected)와 자동·수동 재연결 액션을 한곳에 둔다. 영속하지 않는다.
// 실제 연결 동작은 앱 조립 쪽(app/bootstrap)이 setReconnectHandler로 끼운다 — 이 스토어는 소스 종류를 모른다.
// - 자동: 손이 끊기면 bootstrap이 start()를 부르고, 시도를 최대 3회(max) 이어서 한다. 시도 하나의 성패는 핸들러가 정한다(3초 대기 포함).
// - 수동: 화면의 [다시 연결]이 reconnect()를 부른다. 시도 중이면 지금 시도를 끊고 바로 다음 번호로, 실패·대기 상태면 1회부터 다시 한다.
// - settle(): 필요한 손이 모두 돌아오면 bootstrap이 알린다. 루프를 멈추고 'reconnected'(약 1초, 카드에 「재연결 성공!」) 뒤 idle로 돌아간다.
// - hint: 3회 실패 때 화면이 보일 소스별 안내 문구. 핸들러를 등록할 때 함께 받는다.
import { create } from 'zustand';

/** 시도 하나를 수행한다. 필요한 손이 모두 붙으면 resolve, 시간 안에 못 붙거나 실패면 reject. signal이 취소되면 즉시 reject해야 한다 */
export type ReconnectHandler = (attempt: number, signal: AbortSignal) => Promise<void>;

export type ReconnectStatus = 'idle' | 'trying' | 'failed' | 'reconnected';

interface ReconnectState {
  status: ReconnectStatus;
  /** 지금 몇 번째 시도인지(1부터). idle·reconnected면 0, failed면 마지막 시도 번호 */
  attempt: number;
  /** 최대 시도 횟수 */
  max: number;
  /** 핸들러가 등록돼 있는지. 아니면 [다시 연결]을 숨긴다 */
  available: boolean;
  /** 실패 안내 문구(소스별). 없으면 빈 문자열 */
  hint: string;

  /** 자동 루프를 1회부터 시작한다. 시도 중이거나 핸들러가 없으면 무시한다 */
  start: () => void;
  /** 수동 재연결. 시도 중이면 현재 시도를 끊고 다음 번호로(3 초과면 failed), 아니면 start()와 같다 */
  reconnect: () => Promise<void>;
  /** 손이 모두 돌아왔다. 루프를 멈추고 trying·failed였다면 reconnected로 두고 1초 뒤 idle */
  settle: () => void;
}

const MAX_ATTEMPTS = 3;
/** 「재연결 성공!」을 보이는 시간 */
const RECONNECTED_SHOW_MS = 1000;

let handler: ReconnectHandler | null = null;
let controller: AbortController | null = null;
/** 취소·교체된 시도가 늦게 끝나도 상태를 건드리지 못하게 하는 번호 */
let runId = 0;
let reconnectedTimer: ReturnType<typeof setTimeout> | null = null;

function clearReconnectedTimer(): void {
  if (reconnectedTimer !== null) clearTimeout(reconnectedTimer);
  reconnectedTimer = null;
}

/** 진행 중인 시도를 끊는다(signal abort + 번호 무효화) */
function cancelLoop(): void {
  controller?.abort();
  controller = null;
  runId++;
}

export const useReconnect = create<ReconnectState>()((set, get) => {
  /** n번째 시도를 시작한다. 이전 시도는 먼저 끊는다 */
  function begin(n: number): void {
    const run = handler;
    if (!run) return;
    cancelLoop();
    clearReconnectedTimer();
    const ctrl = new AbortController();
    controller = ctrl;
    const id = runId;
    set({ status: 'trying', attempt: n });
    run(n, ctrl.signal).then(
      () => {
        if (id !== runId || ctrl.signal.aborted) return;
        // 복귀는 보통 bootstrap이 먼저 settle()로 알린다. 아직이면 여기서 마무리한다
        get().settle();
      },
      () => {
        if (id !== runId || ctrl.signal.aborted) return;
        if (n < MAX_ATTEMPTS) begin(n + 1);
        else {
          controller = null;
          set({ status: 'failed', attempt: n });
        }
      },
    );
  }

  return {
    status: 'idle',
    attempt: 0,
    max: MAX_ATTEMPTS,
    available: false,
    hint: '',

    start: () => {
      if (!handler || get().status === 'trying') return;
      begin(1);
    },

    reconnect: async () => {
      if (!handler) return;
      const { status, attempt } = get();
      if (status !== 'trying') {
        begin(1);
        return;
      }
      if (attempt >= MAX_ATTEMPTS) {
        cancelLoop();
        set({ status: 'failed', attempt: MAX_ATTEMPTS });
        return;
      }
      begin(attempt + 1);
    },

    settle: () => {
      if (get().status === 'idle') return;
      cancelLoop();
      clearReconnectedTimer();
      set({ status: 'reconnected', attempt: 0 });
      reconnectedTimer = setTimeout(() => {
        reconnectedTimer = null;
        if (get().status === 'reconnected') set({ status: 'idle', attempt: 0 });
      }, RECONNECTED_SHOW_MS);
    },
  };
});

/** 재연결 동작을 등록한다. null이면 해제(연결 개념이 없는 소스). 진행 중인 루프를 끊고 상태도 처음으로 되돌린다 */
export function setReconnectHandler(next: ReconnectHandler | null, hint = ''): void {
  cancelLoop();
  clearReconnectedTimer();
  handler = next;
  useReconnect.setState({ available: next !== null, status: 'idle', attempt: 0, hint: next ? hint : '' });
}
