// 바운더리 거리 계산: 자세가 가장 가까운 패드 원의 경계에서 얼마나 안쪽·바깥쪽인지.
// FE 판정(resolvePad)과 같은 규칙이라 펌웨어가 보낸 margin과 비교하는 기준이 된다. input·domain만 import한다.
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import { resolvePad } from '@/domain/kit/calibration/calibration';
import type { PadId } from '@/domain/kit/pads';
import type { DecodedHit } from '@/input/stickProtocol';
import type { LogRow } from './recording/packetLog';

export interface EdgeResult {
  /** FE 최근접 패드 */
  pad: PadId;
  distanceDeg: number;
  radiusDeg: number;
  /** distance − radius. 음수 = 원 안쪽 */
  edgeDeg: number;
  inside: boolean;
}

export type EdgeTone = 'inside' | 'near' | 'outside';

/** 경계 근처로 보는 폭(도). |edge|가 이 안이면 노랑 */
export const NEAR_DEG = 2;

/** HIT 패킷의 자세. 고도각 = pitch, 방위각 = yaw (HitTable의 fePad 계산과 같은 매핑) */
export function hitPose(h: DecodedHit): { pitch: number; yaw: number } {
  return { pitch: h.elevationDeg, yaw: h.azimuthDeg };
}

/** 최근접 패드의 바운더리 거리. 프로필·앵커가 없으면 null */
export function edgeDeg(profile: CalibrationProfile | null, pose: { pitch: number; yaw: number }): EdgeResult | null {
  const r = resolvePad(profile, pose);
  if (!r || !profile) return null;
  const anchor = profile.anchors[r.pad];
  if (!anchor) return null;
  return {
    pad: r.pad,
    distanceDeg: r.distanceDeg,
    radiusDeg: anchor.radius,
    edgeDeg: r.distanceDeg - anchor.radius,
    inside: r.inside,
  };
}

/** 최근 n개 수신 HIT(최신 → 과거). 버퍼는 오래된 → 최신 순이다 */
function recentHits(rows: readonly LogRow[], n: number): DecodedHit[] {
  const out: DecodedHit[] = [];
  for (let i = rows.length - 1; i >= 0 && out.length < n; i--) {
    const r = rows[i];
    if (r.dir === 'in' && r.decoded?.kind === 'hit') out.push(r.decoded);
  }
  return out;
}

/** 최근 n개 HIT 중 바운더리 안쪽 비율(0~1). 판정 가능한 HIT가 없으면 null */
export function insideRate(rows: readonly LogRow[], profile: CalibrationProfile | null, n = 50): number | null {
  let total = 0;
  let inside = 0;
  for (const h of recentHits(rows, n)) {
    const e = edgeDeg(profile, hitPose(h));
    if (!e) continue;
    total++;
    if (e.inside) inside++;
  }
  return total === 0 ? null : inside / total;
}

/** 최근 n개 HIT 중 펌웨어 pad(null 제외)와 FE 최근접 패드가 같은 비율(0~1) */
export function agreeRate(rows: readonly LogRow[], profile: CalibrationProfile | null, n = 50): number | null {
  let total = 0;
  let agree = 0;
  for (const h of recentHits(rows, n)) {
    if (h.pad === null) continue;
    const e = edgeDeg(profile, hitPose(h));
    if (!e) continue;
    total++;
    if (e.pad === h.pad) agree++;
  }
  return total === 0 ? null : agree / total;
}

/** |edge| ≤ 2° → near, 그 밖에서 음수 → inside, 양수 → outside */
export function edgeTone(edge: number): EdgeTone {
  if (Math.abs(edge) <= NEAR_DEG) return 'near';
  return edge < 0 ? 'inside' : 'outside';
}
