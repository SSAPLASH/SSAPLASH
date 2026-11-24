// 타격에서 집계에 쓸 시각을 고른다 (설계 MODE-006-minigame-speed D7·D20). 다섯 게임이 같이 쓴다.
// 센서 타격은 브라우저에 수~수십 ms 늦게 도착하므로 받은 시각으로 세면 그만큼 손해를 본다.
import type { ResolvedHit } from '@/domain/events';

/**
 * 집계에 쓸 시각(`performance.now()` 축). 타격 시각과 받은 시각 중 이른 값이다.
 * 타격 시각이 받은 시각보다 뒤로 계산돼 있으면(시계 환산 오차) 받은 시각을 쓴다. 타격 시각이 숫자가 아니어도 받은 시각을 쓴다
 */
export function hitTime(hit: Pick<ResolvedHit, 'tHit' | 'tRecv'>): number {
  return Number.isFinite(hit.tHit) ? Math.min(hit.tHit, hit.tRecv) : hit.tRecv;
}
