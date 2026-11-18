// 시작·재개·처음부터 전에 오디오 시계가 흐를 때까지 기다리는 훅 (설계 MODE-001 오디오 시계 시작 대기 4장).
// 리듬 게임·악보 연습이 시계(PlayClock)를 움직이기 직전에 wait(phase)를 기다린다.
// 기다리는 중에 다시 부르면 거짓(중복 진행 방지), 기다리는 사이 화면을 떠나도 거짓을 돌려준다 — 호출자는 참일 때만 진행한다.
// 대기가 AUDIO_WAIT_NOTICE_MS를 넘으면 notice가 참이 된다(「오디오 준비 중…」). 끝나면 진단 이벤트 audioClockWait를 낸다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine, type ClockWaitResult } from '@/audio/AudioEngine';
import { diagTap, type ClockWaitPhase } from '@/engine/diagTap';

/** 대기가 이만큼 넘어가면 안내를 보인다(ms). 평소 대기(약 150ms)는 표시 없이 지나간다 */
export const AUDIO_WAIT_NOTICE_MS = 400;

export interface AudioClockGateDeps {
  /** 대기 함수(테스트 주입). 기본은 audioEngine.whenClockFlowing() */
  wait?: () => Promise<ClockWaitResult>;
}

export interface AudioClockGate {
  /** 안내를 보일지 */
  notice: boolean;
  /** 오디오 시계가 흐를 때까지 기다린다. 참이면 진행해도 된다 */
  wait: (phase: ClockWaitPhase) => Promise<boolean>;
}

export function useAudioClockGate(deps: AudioClockGateDeps = {}): AudioClockGate {
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  const [notice, setNotice] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const wait = useCallback(async (phase: ClockWaitPhase): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    const timer = setTimeout(() => {
      if (alive.current) setNotice(true);
    }, AUDIO_WAIT_NOTICE_MS);
    try {
      const r = await (depsRef.current.wait ?? (() => audioEngine.whenClockFlowing()))();
      diagTap.publish({ type: 'audioClockWait', phase, waitedMs: r.waitedMs, timedOut: r.timedOut, skipped: r.skipped, primed: r.primed });
      return alive.current;
    } finally {
      clearTimeout(timer);
      busy.current = false;
      if (alive.current) setNotice(false);
    }
  }, []);

  return { notice, wait };
}
