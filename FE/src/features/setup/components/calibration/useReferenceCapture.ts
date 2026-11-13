// 시작 위치 보정(PLAY-004): 연결된 손마다 ReferenceCapture를 돌려, 모든 손이 3초 안정되면 기준 자세를 다시 잡는다.
// 2타 보정 상태 기계(calibrationSession)와 섞지 않고 화면 훅에 둔다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReferenceCapture } from './ReferenceCapture';
import { calibrationSession } from '@/runtime/calibrationSession';
import { inputManager } from '@/runtime/sources';
import type { StickId } from '@/domain/events';

export type ReferenceHoldPhase = 'idle' | 'holding' | 'done';

export interface ReferenceHoldView {
  phase: ReferenceHoldPhase;
  /** 0~1, 손별 최소 */
  progress: number;
  /** 도, 손별 최대 */
  spread: number;
  start(): void;
  cancel(): void;
}

const IDLE = { phase: 'idle' as ReferenceHoldPhase, progress: 0, spread: 0 };

export function useReferenceCapture(hands: StickId[]): ReferenceHoldView {
  const [state, setState] = useState(IDLE);
  const handsKey = hands.join(',');
  const handsRef = useRef(hands);
  const offRef = useRef<(() => void) | null>(null);
  const capturesRef = useRef<Map<StickId, ReferenceCapture> | null>(null);

  const stop = useCallback(() => {
    offRef.current?.();
    offRef.current = null;
    capturesRef.current = null;
  }, []);

  const begin = useCallback(() => {
    stop();
    const list = handsRef.current;
    if (list.length === 0) {
      setState(IDLE);
      return;
    }
    const captures = new Map<StickId, ReferenceCapture>(list.map((h) => [h, new ReferenceCapture()]));
    capturesRef.current = captures;
    setState({ phase: 'holding', progress: 0, spread: 0 });
    offRef.current = inputManager.onPose((stickId, pose) => {
      const cap = captures.get(stickId);
      if (!cap) return;
      cap.onPose(pose, performance.now());
      const snaps = [...captures.values()].map((c) => c.snapshot());
      if (snaps.every((s) => s.phase === 'done')) {
        stop();
        calibrationSession.resetPose();
        setState({ phase: 'done', progress: 1, spread: Math.max(...snaps.map((s) => s.spread)) });
        return;
      }
      setState({
        phase: 'holding',
        progress: Math.min(...snaps.map((s) => s.progress)),
        spread: Math.max(...snaps.map((s) => s.spread)),
      });
    });
  }, [stop]);

  const cancel = useCallback(() => {
    stop();
    setState(IDLE);
  }, [stop]);

  // 진행 중 연결된 손이 바뀌면 전부 처음부터. 손이 모두 사라지면 취소
  useEffect(() => {
    handsRef.current = hands;
    if (capturesRef.current) begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handsKey가 hands 내용을 대신한다
  }, [handsKey, begin]);

  useEffect(() => stop, [stop]);

  return { ...state, start: begin, cancel };
}
