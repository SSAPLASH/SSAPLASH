// 매퍼 계층 (설계 D8). 소스는 "어느 스틱이 언제 얼마나 세게 어떤 자세로 쳤는가"만 내고,
// 어느 패드인지는 여기서 정한다. 키 매퍼는 keyMap, 자세 매퍼는 캘리브레이션 프로필을 쓴다.
// 센서가 오면 자세 매퍼에 프로필만 채우면 되고, 매퍼를 고르는 규칙은 바뀌지 않는다.
import type { PadId } from '@/domain/kit/pads';
import type { HitJudgedBy, InputSourceKind, StickHitEvent, StickId } from '@/domain/events';
import type { KeyMap } from '@/domain/kit/keyMap';
import { poseDistance, resolvePad, type CalibrationProfile } from '@/domain/kit/calibration/calibration';
import { AMBIGUOUS_MARGIN_DEG, type OutsidePolicy } from '@/domain/kit/calibration/tuning';

export type MapperKind = 'key' | 'pose';

/** 매핑 결과. pad가 null이면 어느 패드에도 안 들어간 타격 */
export interface PadMapResult {
  pad: PadId | null;
  /** 판정 출처 */
  judgedBy: HitJudgedBy;
  /** 키 매퍼: 바인딩이 정한 스틱. 자세 매퍼는 이벤트의 stickId 그대로 */
  stickId?: StickId;
  /** 자세 매퍼: 가장 가까운 앵커까지 각도 거리 */
  distanceDeg?: number;
  /** 자세 매퍼: 그 앵커의 반경 안인지(nearest 정책으로 밖에서 인정돼도 false) */
  inside?: boolean;
}

/** 소스 종류 → 매퍼. 키보드만 키 매퍼, 나머지(IMU 계열)는 자세 매퍼 */
export function mapperFor(source: InputSourceKind): MapperKind {
  return source === 'keyboard' ? 'key' : 'pose';
}

/** 키 매퍼. keyCode가 없거나 바인딩이 없으면 패드 없음 */
export function mapHitByKey(hit: StickHitEvent, keyMap: KeyMap): PadMapResult {
  const b = hit.keyCode ? keyMap[hit.keyCode] : undefined;
  if (!b) return { pad: null, judgedBy: 'key' };
  return { pad: b.pad, stickId: b.stickId, judgedBy: 'key' };
}

/**
 * 자세 매퍼. 스틱이 판정한 pad가 있으면 그것을 우선한다(설계 3-2).
 * - 후보 없음, 또는 pad가 후보 안: pad 그대로(stick)
 * - pad가 후보 밖이고 애매(ambiguous 또는 margin < AMBIGUOUS_MARGIN_DEG): 자세로 가장 가까운 후보(chart). 프로필이 없으면 pad 그대로(stick)
 * - pad가 후보 밖이고 확신 있음: pad 그대로(stick, 틀린 패드는 리듬 세션이 MISS 처리)
 * pad가 null·undefined면 프로필의 앵커·반경으로 판정한다(pose).
 * 후보 목록이 있으면 정책과 무관하게 영역 밖이어도 가장 가까운 후보를 인정한다 — 후보가 곧 정답 가설.
 * 후보가 없을 때 반경 밖은 outsidePolicy가 정한다: 'mute' 판정 없음 / 'nearest' 가장 가까운 앵커 패드.
 */
export function mapHitByPose(
  hit: StickHitEvent,
  profile: CalibrationProfile | null,
  candidates?: PadId[],
  outsidePolicy: OutsidePolicy = 'mute',
): PadMapResult {
  const pose = { pitch: hit.pitch, yaw: hit.yaw };
  const stickPad = hit.pad;
  if (stickPad) {
    // 스틱 pad 그대로일 때 근거: 프로필에 그 앵커가 있으면 자세와의 거리·반경 안 여부
    const anchor = profile?.anchors[stickPad];
    const asStick = (): PadMapResult => {
      if (!anchor) return { pad: stickPad, judgedBy: 'stick' };
      const d = poseDistance(pose, anchor);
      return { pad: stickPad, judgedBy: 'stick', distanceDeg: d, inside: d <= anchor.radius };
    };
    if (!candidates || candidates.includes(stickPad)) return asStick();
    const ambiguous = hit.ambiguous === true || (hit.marginDeg !== undefined && hit.marginDeg < AMBIGUOUS_MARGIN_DEG);
    if (!ambiguous) return asStick();
    const r = resolvePad(profile, pose, candidates);
    if (!r) return asStick();
    return { pad: r.pad, judgedBy: 'chart', distanceDeg: r.distanceDeg, inside: r.inside };
  }
  const r = resolvePad(profile, pose, candidates);
  if (!r) return { pad: null, judgedBy: 'pose' };
  const accept = r.inside || !!candidates || outsidePolicy === 'nearest';
  return { pad: accept ? r.pad : null, judgedBy: 'pose', distanceDeg: r.distanceDeg, inside: r.inside };
}

/** 소스 종류에 맞는 매퍼를 골라 적용한다 */
export function mapHit(
  hit: StickHitEvent,
  source: InputSourceKind,
  ctx: { keyMap: KeyMap; profile: CalibrationProfile | null; candidates?: PadId[]; outsidePolicy?: OutsidePolicy },
): PadMapResult {
  return mapperFor(source) === 'key'
    ? mapHitByKey(hit, ctx.keyMap)
    : mapHitByPose(hit, ctx.profile, ctx.candidates, ctx.outsidePolicy);
}
