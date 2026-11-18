// 연주 중 LLM 구간 사실의 스틱 끝 방향(aim) 기준. 키트 판정과 같은 손별 패드 기준 자세·반경을 쓴다
// (설계 COACH-001 각도·실측평가 3.2). 판마다 연주 시작 때 한 번 읽는다.
import type { AimSource } from '@/coach/live';
import type { YawDriftStatus } from '@/domain/kit/calibration/calibration';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

/** 마지막 방위각 드리프트 판정이 이만큼(도) 넘게 어긋나 있으면 그 손의 좌우 치우침은 말하지 않는다(가정값) */
export const AIM_YAW_DRIFT_DEG = 8;

export function yawTrusted(status: YawDriftStatus | null): boolean {
  return status === null || status.lastErrorDeg === null || Math.abs(status.lastErrorDeg) < AIM_YAW_DRIFT_DEG;
}

export function liveAimSource(): AimSource {
  return {
    anchors: useSettings.getState().stickAnchors,
    trustYaw: (stickId) => yawTrusted(useLive.getState().yawDrift[stickId]),
  };
}
