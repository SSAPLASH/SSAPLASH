// MODE-002 화면 터치 입력. 드럼 킷의 패드를 누르면 어느 패드인지를 실은 타격 이벤트를 낸다(설계 3-3).
// 키보드처럼 항상 켜진 보조 소스이고 센서가 아니다(isSensorSource). 판정은 자세 매퍼가 이벤트의 pad를 그대로 쓴다.
import type { StickId } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { BaseInputSource } from './InputSource';

/** 터치 타격 세기 고정값(U4). 손가락으로는 세기를 알 수 없다 */
export const TOUCH_VELOCITY = 100;
/** 키보드와 같은 가속도 모사값 */
const TOUCH_ACCEL_G = 6.3;

export class TouchPadSource extends BaseInputSource {
  readonly kind = 'touch' as const;
  readonly label = '화면 터치';
  /** 손 구분 정보가 없어 0·1을 번갈아 쓴다 */
  private nextStick: StickId = 0;

  async connect(): Promise<void> {
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    this.setState('disconnected');
  }

  /** 패드 하나를 친다. pointerdown에서 바로 부른다 */
  strike(pad: PadId): void {
    const now = performance.now();
    const stickId = this.nextStick;
    this.nextStick = stickId === 0 ? 1 : 0;
    this.emit({
      kind: 'hit',
      stickId,
      timestamp: now,
      recvTime: now,
      pad,
      velocity: TOUCH_VELOCITY,
      peakAccel: TOUCH_ACCEL_G,
      pitch: 0,
      yaw: 0,
    });
  }
}
