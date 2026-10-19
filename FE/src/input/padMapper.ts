// 매퍼 계층 (설계 D8). 소스는 "어느 스틱이 언제 얼마나 세게 어떤 자세로 쳤는가"만 내고,
// 어느 패드인지는 여기서 정한다. 키 매퍼는 keyMap, 자세 매퍼는 캘리브레이션 프로필을 쓴다.
// 센서가 오면 자세 매퍼에 프로필만 채우면 되고, 매퍼를 고르는 규칙은 바뀌지 않는다.
import type { PadId } from '@/domain/pads';
import type { InputSourceKind, StickHitEvent, StickId } from '@/domain/events';
import type { KeyMap } from '@/domain/keyMap';
import { resolvePad, type CalibrationProfile } from '@/domain/calibration';

export type MapperKind = 'key' | 'pose';

/** 매핑 결과. pad가 null이면 어느 패드에도 안 들어간 타격 */
export interface PadMapResult {
  pad: PadId | null;
  /** 키 매퍼: 바인딩이 정한 스틱. 자세 매퍼는 이벤트의 stickId 그대로 */
  stickId?: StickId;
  /** 자세 매퍼: 가장 가까운 앵커까지 각도 거리 */
  distanceDeg?: number;
}

/** 소스 종류 → 매퍼. 키보드만 키 매퍼, 나머지(IMU 계열)는 자세 매퍼 */
export function mapperFor(source: InputSourceKind): MapperKind {
  return source === 'keyboard' ? 'key' : 'pose';
}

/** 키 매퍼. keyCode가 없거나 바인딩이 없으면 패드 없음 */
export function mapHitByKey(hit: StickHitEvent, keyMap: KeyMap): PadMapResult {
  const b = hit.keyCode ? keyMap[hit.keyCode] : undefined;
  if (!b) return { pad: null };
  return { pad: b.pad, stickId: b.stickId };
}

/**
 * 자세 매퍼. 프로필의 앵커·반경으로 판정한다.
 * 후보 목록이 있으면(채보 후보 제한) 영역 밖이어도 가장 가까운 후보를 인정한다 — 후보가 곧 정답 가설.
 */
export function mapHitByPose(
  hit: StickHitEvent,
  profile: CalibrationProfile | null,
  candidates?: PadId[],
): PadMapResult {
  const r = resolvePad(profile, { pitch: hit.pitch, yaw: hit.yaw }, candidates);
  if (!r) return { pad: null };
  return { pad: r.inside || candidates ? r.pad : null, distanceDeg: r.distanceDeg };
}

/** 소스 종류에 맞는 매퍼를 골라 적용한다 */
export function mapHit(
  hit: StickHitEvent,
  source: InputSourceKind,
  ctx: { keyMap: KeyMap; profile: CalibrationProfile | null; candidates?: PadId[] },
): PadMapResult {
  return mapperFor(source) === 'key'
    ? mapHitByKey(hit, ctx.keyMap)
    : mapHitByPose(hit, ctx.profile, ctx.candidates);
}
