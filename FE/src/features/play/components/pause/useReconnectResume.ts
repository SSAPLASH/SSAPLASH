// 끊김에서 복귀 → 「재연결 성공!」 1초 → (재정렬 필요 시 스네어 프롬프트) → 카운트다운(3·2·1·시작!) → 자동 재개 (PLAY-002 설계 4-5, D9 · PLAY-004 D12).
// 흐름: pauseReason이 'disconnected'인데 준비(ready)가 회복되면 'reconnected'로 바꾸고, 1초 뒤 일시정지를 풀며 카운트다운을 시작한다.
// 1초가 지났을 때 재정렬이 걸려 있으면(realignPending) 카드를 유지한 채 'realigning'으로 기다렸다가, 끝나거나 건너뛰면 카운트다운.
// 끝나면 resume()을 부른다. 도중 ready가 다시 false가 되면 타이머를 모두 지우고 끊김 카드로 돌아간다.
// 타이머 로직은 훅 밖의 컨트롤러(createReconnectResume)에 둬서 렌더 없이 가짜 타이머로 검증한다.
import { useCallback, useEffect, useRef } from 'react';
import type { PauseReason } from './PauseOverlay';

/** 「재연결 성공!」 카드를 보이는 시간(ms) */
export const RECONNECTED_NOTICE_MS = 1000;
/** 카운트다운 숫자 간격(ms) */
export const RESUME_COUNT_STEP_MS = 1000;

export type ResumeCountValue = number | 'go';

export interface ReconnectResumeDeps {
  setPauseReason: (reason: PauseReason | null) => void;
  setCountValue: (value: ResumeCountValue | null) => void;
  /** 카운트다운이 끝나 이어서 연주한다 */
  resume: () => void;
  /** 다시 끊겼을 때 끊김 카드로 되돌린다 */
  pauseTo: (reason: PauseReason) => void;
  /** 「시작!」을 보이는 시간(ms). 페이지의 GO_MS와 맞춘다 */
  goMs: number;
}

type Phase = 'idle' | 'reconnected' | 'realigning' | 'counting';

export interface ReconnectResumeController {
  /** pauseReason·ready·realignPending이 바뀔 때마다 부른다. realignPending = 스네어 재정렬 프롬프트가 떠 있어 카운트다운을 미뤄야 함 */
  update: (pauseReason: PauseReason | null, ready: boolean, realignPending?: boolean) => void;
  /** 재개 카운트다운 중인지(Esc를 무시하려고) */
  isResuming: () => boolean;
  /** 언마운트: 타이머만 지우고 상태는 건드리지 않는다 */
  dispose: () => void;
}

export function createReconnectResume(getDeps: () => ReconnectResumeDeps): ReconnectResumeController {
  let phase: Phase = 'idle';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastReady = false;
  let lastRealign = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const finish = () => {
    clear();
    phase = 'idle';
    const d = getDeps();
    d.setCountValue(null);
    if (lastReady) d.resume();
    else d.pauseTo('disconnected');
  };

  const values: ResumeCountValue[] = [3, 2, 1, 'go'];
  const step = (i: number) => {
    const d = getDeps();
    d.setCountValue(values[i]);
    const last = i === values.length - 1;
    timer = setTimeout(last ? finish : () => step(i + 1), last ? d.goMs : RESUME_COUNT_STEP_MS);
  };

  const startCount = () => {
    clear();
    phase = 'counting';
    // 카드를 내리고 카운트다운을 올린다. 포커스는 카드 언마운트(returnFocus 'blur')가 body로 돌린다
    getDeps().setPauseReason(null);
    step(0);
  };

  /** 「재연결 성공!」 1초 뒤: 재정렬이 걸려 있으면 카드를 둔 채 기다리고, 아니면 바로 카운트다운(D12) */
  const afterNotice = () => {
    timer = null;
    if (lastRealign) phase = 'realigning';
    else startCount();
  };

  return {
    update(pauseReason, ready, realignPending = false) {
      lastReady = ready;
      lastRealign = realignPending;
      const d = getDeps();
      if (phase === 'idle') {
        if (pauseReason === 'disconnected' && ready) {
          phase = 'reconnected';
          d.setPauseReason('reconnected');
          timer = setTimeout(afterNotice, RECONNECTED_NOTICE_MS);
        }
      } else if (phase === 'reconnected' || phase === 'realigning') {
        if (pauseReason !== 'reconnected') {
          // 페이지가 다른 값으로 바꿨다(나가기·다시 시작 등)
          clear();
          phase = 'idle';
        } else if (!ready) {
          clear();
          phase = 'idle';
          d.setPauseReason('disconnected');
        } else if (phase === 'realigning' && !realignPending) {
          // 스네어를 쳤거나 [건너뛰기] → 이제 카운트다운
          startCount();
        }
      } else if (pauseReason !== null) {
        // 카운트다운 중 다른 일시정지가 걸렸다(끊김 트리거 포함). 카운트다운만 지운다
        clear();
        phase = 'idle';
        d.setCountValue(null);
      } else if (!ready) {
        clear();
        phase = 'idle';
        d.setCountValue(null);
        d.pauseTo('disconnected');
      }
    },
    isResuming: () => phase === 'counting',
    dispose() {
      clear();
      phase = 'idle';
    },
  };
}

interface Options extends ReconnectResumeDeps {
  pauseReason: PauseReason | null;
  ready: boolean;
  /** 스네어 재정렬 프롬프트가 떠 있어 카운트다운을 미뤄야 하는지(useRealign().pending). 기본 false */
  realignPending?: boolean;
}

/** 반환 isResuming: 카운트다운 중이면 true. Esc 핸들러가 무시 여부를 정할 때 쓴다 */
export function useReconnectResume({ pauseReason, ready, realignPending = false, setPauseReason, setCountValue, resume, pauseTo, goMs }: Options): {
  isResuming: () => boolean;
} {
  const depsRef = useRef<ReconnectResumeDeps>({ setPauseReason, setCountValue, resume, pauseTo, goMs });
  useEffect(() => {
    depsRef.current = { setPauseReason, setCountValue, resume, pauseTo, goMs };
  }, [setPauseReason, setCountValue, resume, pauseTo, goMs]);

  const ctrlRef = useRef<ReconnectResumeController | null>(null);
  const ctrl = useCallback(() => {
    ctrlRef.current ??= createReconnectResume(() => depsRef.current);
    return ctrlRef.current;
  }, []);

  useEffect(() => {
    ctrl().update(pauseReason, ready, realignPending);
  }, [ctrl, pauseReason, ready, realignPending]);

  useEffect(() => {
    const c = ctrl();
    return () => c.dispose();
  }, [ctrl]);

  const isResuming = useCallback(() => ctrl().isResuming(), [ctrl]);
  return { isResuming };
}
