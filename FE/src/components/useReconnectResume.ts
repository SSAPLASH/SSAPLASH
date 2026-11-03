// 끊김에서 복귀 → 「재연결 성공!」 1초 → 카운트다운(3·2·1·시작!) → 자동 재개 (PLAY-002 설계 4-5, D9). 리듬 게임·악보 연습이 함께 쓴다.
// 흐름: pauseReason이 'disconnected'인데 준비(ready)가 회복되면 'reconnected'로 바꾸고, 1초 뒤 일시정지를 풀며 카운트다운을 시작한다.
// 끝나면 resume()을 부른다. 도중 ready가 다시 false가 되면 타이머를 모두 지우고 끊김 카드로 돌아간다.
// 타이머 로직은 훅 밖의 컨트롤러(createReconnectResume)에 둬서 렌더 없이 가짜 타이머로 검증한다.
import { useCallback, useEffect, useRef } from 'react';
import type { PauseReason } from '@/components/PauseOverlay';

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

type Phase = 'idle' | 'reconnected' | 'counting';

export interface ReconnectResumeController {
  /** pauseReason·ready가 바뀔 때마다 부른다 */
  update: (pauseReason: PauseReason | null, ready: boolean) => void;
  /** 재개 카운트다운 중인지(Esc를 무시하려고) */
  isResuming: () => boolean;
  /** 언마운트: 타이머만 지우고 상태는 건드리지 않는다 */
  dispose: () => void;
}

export function createReconnectResume(getDeps: () => ReconnectResumeDeps): ReconnectResumeController {
  let phase: Phase = 'idle';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastReady = false;

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

  return {
    update(pauseReason, ready) {
      lastReady = ready;
      const d = getDeps();
      if (phase === 'idle') {
        if (pauseReason === 'disconnected' && ready) {
          phase = 'reconnected';
          d.setPauseReason('reconnected');
          timer = setTimeout(startCount, RECONNECTED_NOTICE_MS);
        }
      } else if (phase === 'reconnected') {
        if (pauseReason !== 'reconnected') {
          // 페이지가 다른 값으로 바꿨다(나가기·다시 시작 등)
          clear();
          phase = 'idle';
        } else if (!ready) {
          clear();
          phase = 'idle';
          d.setPauseReason('disconnected');
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
}

/** 반환 isResuming: 카운트다운 중이면 true. Esc 핸들러가 무시 여부를 정할 때 쓴다 */
export function useReconnectResume({ pauseReason, ready, setPauseReason, setCountValue, resume, pauseTo, goMs }: Options): {
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
    ctrl().update(pauseReason, ready);
  }, [ctrl, pauseReason, ready]);

  useEffect(() => {
    const c = ctrl();
    return () => c.dispose();
  }, [ctrl]);

  const isResuming = useCallback(() => ctrl().isResuming(), [ctrl]);
  return { isResuming };
}
