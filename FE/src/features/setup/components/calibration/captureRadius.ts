// 보정 카드 반지름 슬라이더 값 계산(순수 함수, UX-64 D9). 컴포넌트 파일과 분리해 테스트와 Fast Refresh가 편하게 한다.
import type { CaptureSnapshot } from '@/engine/HitCapture';
import { computeBoundaries, type HandAnchorSet } from '@/domain/kit/calibration/calibration';
import type { PadId } from '@/domain/kit/pads';
import type { SensorTuning } from '@/domain/kit/calibration/tuning';

/**
 * 슬라이더에 보일 판정 반경(°): 사용자 값이 있으면 그 값(하한~상한으로 자름), 없으면 지금까지 잡힌 앵커로 자동값을 미리 계산한다(손별 평균).
 * 아직 그 패드를 잡지 못했으면 상한(앵커 하나뿐일 때의 자동값과 같다)
 */
export function previewRadius(cap: CaptureSnapshot, pad: PadId, tuning: SensorTuning): number {
  const ov = cap.radiusOverrides[pad];
  if (ov !== undefined) return Math.min(tuning.maxRadiusDeg, Math.max(tuning.minRadiusDeg, ov));
  const radii: number[] = [];
  for (const h of cap.hands) {
    const set: HandAnchorSet = {};
    for (const p of cap.order) {
      const a = cap.captured[p]?.[h];
      if (a) set[p] = a;
    }
    const r = computeBoundaries(set, tuning.maxRadiusDeg, tuning.radiusFactor, tuning.minRadiusDeg)[pad]?.radius;
    if (r !== undefined) radii.push(r);
  }
  if (radii.length === 0) return tuning.maxRadiusDeg;
  return radii.reduce((s, v) => s + v, 0) / radii.length;
}
