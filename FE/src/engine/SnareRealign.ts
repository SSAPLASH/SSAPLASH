// 재정렬 상태 기계(PLAY-004 3-6). 스틱을 껐다 켜거나 재연결해 방위각 기준이 밀렸을 때,
// 손마다 스네어를 한 번 쳐서 저장된 스네어 앵커 방위각과의 차 d를 낸다. 오프셋 전송은 세션이 한다(D5).
import type { Pose, StickId } from '@/domain/events';
import { wrap180 } from '@/domain/kit/calibration/calibration';

export interface RealignSnapshot {
  /** 재정렬 대상 손 */
  hands: StickId[];
  done: [boolean, boolean];
  /** 대상 손이 모두 끝났는지 */
  finished: boolean;
}

type Listener = (s: RealignSnapshot) => void;

export class SnareRealign {
  private hands: StickId[] = [];
  private snareYaw: [number | null, number | null] = [null, null];
  private done: [boolean, boolean] = [false, false];
  private listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot());
    return () => this.listeners.delete(l);
  }

  snapshot(): RealignSnapshot {
    return { hands: [...this.hands], done: [...this.done], finished: this.isFinished() };
  }

  private notify(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  private isFinished(): boolean {
    return this.hands.every((h) => this.done[h]);
  }

  /**
   * 시작. snareYaw는 손별 저장 스네어 앵커 방위각. 앵커가 없는 손(null)은 대상에서 뺀다(전체 보정이 필요한 손)
   */
  start(hands: StickId[], snareYaw: [number | null, number | null]): void {
    this.snareYaw = [snareYaw[0], snareYaw[1]];
    this.hands = [...new Set(hands)].filter((h) => this.snareYaw[h] !== null).sort() as StickId[];
    this.done = [false, false];
    this.notify();
  }

  /** 대상 손이 끊겼다: 대상에서 뺀다 */
  dropHand(stickId: StickId): void {
    if (!this.hands.includes(stickId)) return;
    this.hands = this.hands.filter((h) => h !== stickId);
    this.notify();
  }

  /** 그 손이 지금 재정렬 대상인가(미완료 포함) */
  targets(stickId: StickId): boolean {
    return this.hands.includes(stickId) && !this.done[stickId];
  }

  /**
   * 스네어 타격. 그 손이 대상이고 미완료면 d = wrap180(친 방위각 − 저장 스네어 방위각)을 돌려주고 완료로.
   * 대상이 아니거나 이미 끝났으면 null
   */
  onHit(stickId: StickId, pose: Pose): number | null {
    if (!this.targets(stickId)) return null;
    const ref = this.snareYaw[stickId];
    if (ref === null) return null;
    this.done[stickId] = true;
    this.notify();
    return wrap180(pose.yaw - ref);
  }
}
