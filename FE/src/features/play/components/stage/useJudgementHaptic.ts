// 곡 연주 판정 진동 (PLAY-006). 판정을 쓰는 화면(리듬 게임·악보 연습)이 이 훅 하나로 같은 규칙을 따른다.
//  - active인 동안 스틱 로컬 진동을 끈다(hapticMode 판정 모드).
//  - PERFECT·GOOD 판정이 나면 즉시 그 손에만 파형 진동을 보낸다. 모으거나 프레임까지 미루지 않는다.
//  - 설정 playHaptic이 local이고 모니터 빌드면(비교용, 그 밖의 빌드는 항상 판정 진동) 위 둘을 모두 하지 않는다. 스틱이 치는 즉시 직접 진동한다.
//  - MISS·손 없는 판정(키보드·터치)에는 보내지 않는다.
import { useEffect } from 'react';
import { effectivePlayHaptic, enterJudgementHaptic, leaveJudgementHaptic } from '@/features/play/hapticMode';
import { inputManager } from '@/runtime/sources';
import { useSettings } from '@/store/settingsStore';
import { waveForJudgement } from '@/features/play/domain/haptics';
import type { JudgementEvent, RhythmSession } from '@/engine/RhythmSession';

/** 판정 구독 + 모드 진입을 묶고, 해제 함수를 돌려준다(훅 밖에서 렌더 없이 검증하려고 분리) */
export function attachJudgementHaptic(session: Pick<RhythmSession, 'onJudgement'>): () => void {
  // 진동 방식은 연주 단계에 들어갈 때 한 번 읽어 그 판 동안 고정한다. local이면 스틱 로컬 진동을 그대로 두고 FE는 보내지 않는다
  if (effectivePlayHaptic(useSettings.getState().playHaptic) === 'local') return () => {};
  enterJudgementHaptic();
  const off = session.onJudgement((e: JudgementEvent) => {
    const wave = waveForJudgement(e.judgement);
    if (wave === null || e.stickId === null) return;
    inputManager.hapticWave(e.stickId, wave);
  });
  return () => {
    off();
    leaveJudgementHaptic();
  };
}

export function useJudgementHaptic(session: RhythmSession | null, active: boolean): void {
  useEffect(() => {
    if (!active || !session) return;
    return attachJudgementHaptic(session);
  }, [session, active]);
}
