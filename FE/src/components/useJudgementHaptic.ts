// 곡 연주 판정 진동 (PLAY-006). 판정을 쓰는 화면(리듬 게임·악보 연습)이 이 훅 하나로 같은 규칙을 따른다.
//  - active인 동안 스틱 로컬 진동을 끈다(hapticMode 판정 모드).
//  - PERFECT·GOOD 판정이 나면 즉시 그 손에만 파형 진동을 보낸다. 모으거나 프레임까지 미루지 않는다.
//  - MISS·손 없는 판정(키보드·터치)에는 보내지 않는다.
import { useEffect } from 'react';
import { enterJudgementHaptic, leaveJudgementHaptic } from '@/app/hapticMode';
import { inputManager } from '@/app/sources';
import { waveForJudgement } from '@/domain/haptics';
import type { JudgementEvent, RhythmSession } from '@/engine/RhythmSession';

/** 판정 구독 + 모드 진입을 묶고, 해제 함수를 돌려준다(훅 밖에서 렌더 없이 검증하려고 분리) */
export function attachJudgementHaptic(session: Pick<RhythmSession, 'onJudgement'>): () => void {
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
