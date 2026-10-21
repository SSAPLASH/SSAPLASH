// 실시간 상태 (영속 안 함): 스틱 연결·자세·최근 타격·소스 상태.
// 자세는 60Hz로 들어오므로 구독 컴포넌트는 필요한 필드만 select 한다.
import { create } from 'zustand';
import type { PadId } from '@/domain/pads';
import type { Pose, ResolvedHit, SensorId, SourceState } from '@/domain/events';

interface LiveState {
  connected: [boolean, boolean];
  pose: [Pose, Pose];
  lastHit: ResolvedHit | null;
  sourceState: SourceState;
  sourceMessage: string | null;
  /** 지금 켜진 센서 소스. 키보드는 항상 켜져 있어 여기 안 나온다 */
  activeSensor: SensorId;
  audioReady: boolean;
  /** 타격마다 1씩 증가. 효과 트리거용 */
  hitSeq: number;
  /** 사운드 세트 로딩 상태. 'idle'은 아직 로드를 시작하지 않음 */
  soundSetState: 'idle' | 'loading' | 'ready' | 'error';
  /** 샘플이 없어 합성음으로 폴백하는 패드 */
  soundSetMissing: PadId[];
}

export const useLive = create<LiveState>(() => ({
  connected: [false, false],
  pose: [
    { pitch: 0, yaw: 0 },
    { pitch: 0, yaw: 0 },
  ],
  lastHit: null,
  sourceState: 'disconnected',
  sourceMessage: null,
  activeSensor: 'none',
  audioReady: false,
  hitSeq: 0,
  soundSetState: 'idle',
  soundSetMissing: [],
}));
