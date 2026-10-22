// 실시간 상태 (영속 안 함): 스틱 연결·자세·최근 타격·소스 상태.
// 자세는 60Hz로 들어오므로 구독 컴포넌트는 필요한 필드만 select 한다.
import { create } from 'zustand';
import type { PadId } from '@/domain/pads';
import { BPM_DEFAULT, type BeatsPerBar } from '@/domain/metronome';
import type { Pose, ResolvedHit, SensorId, SourceState } from '@/domain/events';

/** 전역 메트로놈 화면용 사본. 값의 주인은 engine/Metronome이고 bootstrap이 여기 옮긴다 */
export interface MetronomeLive {
  playing: boolean;
  bpm: number;
  beatsPerBar: BeatsPerBar;
  /** 지금 울리고 있는 박의 마디 안 인덱스(0부터). 정지 중 -1 */
  beat: number;
  /** 박마다 1씩 증가. 같은 beat 값이 이어져도 깜빡임을 다시 트리거하려는 용도 */
  beatSeq: number;
  /** 곡 연주 중 잠금 — bpm·beatsPerBar는 곡 값이고 칩 조작이 비활성이다 */
  locked: boolean;
}

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
  metronome: MetronomeLive;
  /** 3초 기준 자세 보정을 마친 시각(Date.now, 표시용). 아직 안 했으면 null. 세션 값 */
  referenceSetAt: number | null;
  /** 보정 뒤 센서 연결이 끊겼다 — 재연결 후 다시 맞추라는 안내용 */
  referenceStale: boolean;
  /** 일시정지 요청. E0 사이드바가 'menu'로 올리면 곡 연주 페이지가 일시정지하고 null로 되돌린다 */
  pauseRequested: 'menu' | null;
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
  metronome: { playing: false, bpm: BPM_DEFAULT, beatsPerBar: 4, beat: -1, beatSeq: 0, locked: false },
  referenceSetAt: null,
  referenceStale: false,
  pauseRequested: null,
}));
