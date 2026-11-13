// 자유 연주(MODE-02) 타격 통계. 순수 함수 — 페이지 로컬 상태로만 쓰고 저장하지 않는다.
// 자유 연습 정보 띠는 타격 수·평균 세기를, 모니터 빌드의 실측 섹션은 패드별·앵커 거리를 쓴다.
// 판정 반경 상수(미결 U6)와 앵커 밖 타격 처리(미결 U11)를 하드웨어 실측으로 정할 때 쓰는 임시 집계다.
import type { ResolvedHit } from '../events';
import { ALL_PADS, type PadId } from '@/domain/kit/pads';
import { isSensorSource } from '@/domain/events';

export interface HitStats {
  total: number;
  byPad: Record<PadId, number>;
  /** 패드가 정해지지 않은 타격(앵커 밖, 프로필 없음) */
  unresolved: number;
  /** 센서 타격(키보드 제외) 중 앵커 거리가 있는 것의 합·개수. 평균 = sum / count */
  sensorDistanceSum: number;
  sensorDistanceCount: number;
  /** 세기(0~127)의 합·개수. 평균 = sum / count */
  velocitySum: number;
  velocityCount: number;
}

export type HitStatsInput = Pick<ResolvedHit, 'pad' | 'source' | 'distanceDeg'> & Partial<Pick<ResolvedHit, 'velocity'>>;

export function emptyHitStats(): HitStats {
  const byPad = {} as Record<PadId, number>;
  for (const p of ALL_PADS) byPad[p] = 0;
  return { total: 0, byPad, unresolved: 0, sensorDistanceSum: 0, sensorDistanceCount: 0, velocitySum: 0, velocityCount: 0 };
}

/** 새 객체를 돌려준다 (React 상태 갱신용). 원본은 바꾸지 않는다 */
export function addHit(stats: HitStats, hit: HitStatsInput): HitStats {
  const next: HitStats = { ...stats, byPad: { ...stats.byPad } };
  next.total += 1;
  if (hit.pad) next.byPad[hit.pad] += 1;
  else next.unresolved += 1;
  if (isSensorSource(hit.source) && hit.distanceDeg !== undefined) {
    next.sensorDistanceSum += hit.distanceDeg;
    next.sensorDistanceCount += 1;
  }
  if (hit.velocity !== undefined) {
    next.velocitySum += hit.velocity;
    next.velocityCount += 1;
  }
  return next;
}

/** 평균 세기(0~127). 타격이 없으면 null */
export function meanVelocity(stats: HitStats): number | null {
  return stats.velocityCount === 0 ? null : stats.velocitySum / stats.velocityCount;
}

/** 센서 타격 평균 앵커 거리(°). 센서 타격이 없으면 null */
export function meanSensorDistance(stats: HitStats): number | null {
  return stats.sensorDistanceCount === 0 ? null : stats.sensorDistanceSum / stats.sensorDistanceCount;
}
