// 곡 시작 진단 줄(session·anchors)에 실을 설정 값. 연주 화면(PlayPage·SheetPage)이 diagSessionStart에 그대로 넘긴다.
// 구독자가 없으면 앵커를 만들지 않는다(반경 계산 비용, 설계 PLAY-002 live-play-diagnostics D7).
import { anchorsToProfile } from '@/domain/kit/kitJudge';
import { kickOffsetOrStick } from '@/domain/kit/calibration/timingCalibration';
import type { TimingWindows } from '@/domain/play/judgement';
import { diagTap } from '@/engine/diagTap';
import type { DiagSessionOpts } from '@/engine/diagReport';
import { effectivePlayHaptic } from '@/features/play/hapticMode';
import { useSettings } from '@/store/settingsStore';

/** windows: 이 판에 적용된 판정 폭(초보 대상이면 넓힌 값). 설정 값을 그대로 읽지 않는다 */
export function diagSessionOpts(windows: TimingWindows): DiagSessionOpts {
  const s = useSettings.getState();
  const base: DiagSessionOpts = {
    windows,
    audioOffsetMs: s.audioOffsetMs,
    kickOffsetMs: kickOffsetOrStick(s.audioOffsetMs, s.kickOffsetMs),
    haptic: effectivePlayHaptic(s.playHaptic),
  };
  if (!diagTap.active) return base;
  // 보정한 손만 판정 프로필과 같은 반경(자동값·override 반영)으로 싣는다. 보정 안 한 손은 null
  const hand = (i: 0 | 1) => (s.stickAnchors[i] ? anchorsToProfile(s.stickAnchors[i], s.tuning, i).anchors : null);
  return { ...base, anchors: [hand(0), hand(1)], calibratedAt: s.calibratedAt, presetId: s.activePresetId };
}
