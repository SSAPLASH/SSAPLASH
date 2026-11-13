// 재정렬 자동 시작 훅(PLAY-004 3-9). 네 진입점(세팅 ②·시작 확인 창·곡 연주 복귀·자유 연습)이 공용으로 쓴다.
// 이 화면에 있는 동안 재정렬이 필요한 손(realignNeeded)이 생기고 세션이 놀고 있으면 startRealign()을 부르고,
// enabled가 꺼지거나 언마운트하면 cancelRealign()으로 접는다(realignNeeded는 남아 다음 화면이 이어받는다).
import { useEffect, useState } from 'react';
import type { RealignInfo } from './RealignPrompt';
import { calibrationSession } from '@/runtime/calibrationSession';
import { useLive, type CalibrationSnapshot } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

export interface RealignState {
  /** 지금 이 세션이 재정렬 중(프롬프트를 보여야 함) */
  pending: boolean;
  snapshot: CalibrationSnapshot;
  skip: () => void;
  /** pending일 때 RealignPrompt에 그대로 넘길 값. 아니면 null */
  info: RealignInfo | null;
}

export function useRealign(enabled: boolean): RealignState {
  const snapshot = useLive((l) => l.calibration);
  const needed = useLive((l) => l.realignNeeded);
  const connected = useLive((l) => l.connected);
  const anchors = useSettings((s) => s.stickAnchors);
  const drift = useLive((l) => l.yawDrift);
  const hasTarget =
    enabled && ([0, 1] as const).some((i) => needed[i] && connected[i] && anchors[i] !== null) && snapshot.mode === 'idle';

  useEffect(() => {
    if (hasTarget) calibrationSession.startRealign();
  }, [hasTarget]);

  useEffect(() => {
    if (!enabled) calibrationSession.cancelRealign();
    return () => calibrationSession.cancelRealign();
  }, [enabled]);

  const pending = snapshot.mode === 'realign' && snapshot.realign !== null;
  const skip = () => calibrationSession.skipRealign();
  // 자동 보정이 방향 흔들림으로 멈춘 손이 대상에 있으면 문구에 이유를 붙인다. 손 하나를 다 치면 monitor가 그 손의 멈춤을 풀어
  // 문구가 깜빡이지 않도록, 재정렬이 걸려 있는 동안 한 번 true였으면 유지하고 끝나면 비운다
  const [unstable, setUnstable] = useState(false);
  const haltedTarget = pending && snapshot.realign!.hands.some((h) => drift[h]?.halted);
  if (haltedTarget && !unstable) setUnstable(true);
  else if (!pending && unstable) setUnstable(false);
  const info: RealignInfo | null = pending
    ? { hands: snapshot.realign!.hands, done: snapshot.realign!.done, unstable: unstable || undefined, onSkip: skip }
    : null;
  return { pending, snapshot, skip, info };
}
