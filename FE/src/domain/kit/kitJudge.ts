// 손별 앵커 → 판정 프로필·표시 배치 유도(PLAY-004 D1·D2·D4).
// 보정한 손은 저장된 앵커(settingsStore.stickAnchors)로, 보정하지 않은 손은 3D 모델 기본 앵커로 프로필을 만든다.
// 배치(layout)는 판정에 쓰지 않고 앵커에서 유도해 표시만 한다.
import type { StickId } from '../events';
import { computeBoundaries, type CalibrationProfile, type HandAnchorSet } from './calibration/calibration';
import { defaultHandAnchorSet } from './kitModel';
import type { SensorTuning } from './calibration/tuning';

export { anchorsToLayout } from './kitModel';

/**
 * 한 손의 앵커 집합 → 판정 프로필. 반경은 튜닝(계수·하한·상한)으로 다시 계산한다.
 * anchors가 null(보정 안 됨)이면 그 손의 3D 모델 기본 앵커(source 'model')를 쓴다
 */
export function anchorsToProfile(
  anchors: HandAnchorSet | null,
  tuning: SensorTuning,
  stickId: StickId,
  createdAt: string = new Date().toISOString(),
): CalibrationProfile {
  const calibrated = anchors !== null;
  const base = calibrated ? anchors : defaultHandAnchorSet(stickId, tuning);
  return {
    id: calibrated ? `hits-${stickId}` : `model-${stickId}`,
    name: calibrated ? '2타 보정' : '기본 모델',
    createdAt,
    source: calibrated ? 'hits' : 'model',
    anchors: computeBoundaries(base, tuning.maxRadiusDeg, tuning.radiusFactor, tuning.minRadiusDeg),
    maxRadiusDeg: tuning.maxRadiusDeg,
    audioOffsetMs: 0,
  };
}
