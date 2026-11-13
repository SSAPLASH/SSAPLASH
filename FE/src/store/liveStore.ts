// 실시간 상태 (영속 안 함): 스틱 연결·자세·최근 타격·소스 상태.
// 자세는 60Hz로 들어오므로 구독 컴포넌트는 필요한 필드만 select 한다.
import { create } from 'zustand';
import type { PadId } from '@/domain/kit/pads';
import { BPM_DEFAULT, type BeatsPerBar } from '@/domain/time/metronome';
import type { PadTableStatus, YawDriftStatus } from '@/domain/kit/calibration/calibration';
import type { DongleLink, Pose, ResolvedHit, SensorId, SourceState, StickId } from '@/domain/events';
import type { CaptureSnapshot } from '@/engine/HitCapture';
import type { RealignSnapshot } from '@/engine/SnareRealign';
import type { ClockSkew } from '@/domain/kit/device/arrivalSkew';

/** 보정·재정렬 세션 스냅샷(PLAY-004 3-7). runtime/calibrationSession이 쓰고 화면이 읽는다 */
export interface CalibrationSnapshot {
  mode: 'idle' | 'capture' | 'realign';
  capture: CaptureSnapshot | null;
  realign: RealignSnapshot | null;
  /** 지금 세션의 대상 손 */
  hands: StickId[];
  /** 보정 대상(UX-64 D4): new = 추가하기(새 프리셋 초안), active = 적용 프리셋에 바로 반영. 보정 중이 아니면 null */
  target: 'new' | 'active' | null;
}

export const IDLE_CALIBRATION: CalibrationSnapshot = { mode: 'idle', capture: null, realign: null, hands: [], target: null };

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

/** 페달 보드 상태(PLAY-002 3-4). 동글이 role 2·3으로 알린다 */
export interface PedalLive {
  /** [왼발 하이햇, 오른발 킥]. LINK bit2·bit3 */
  connected: [boolean, boolean];
  /** 페달 STATUS 배터리(%, 최근 3개 평균). 모르거나 둘 다 끊기면 null */
  battery: number | null;
  /** 하이햇 페달 밟힘(PEDAL state). 왼발이 끊기면 true로 되돌린다 */
  hihatClosed: boolean;
}

export function initialPedal(): PedalLive {
  return { connected: [false, false], battery: null, hihatClosed: true };
}

interface LiveState {
  connected: [boolean, boolean];
  /** 스틱별 배터리(%, 최근 몇 개 평균). 모르거나 그 손이 끊기면 null */
  battery: [number | null, number | null];
  /** 동글 링크 상태. 동글 소스가 아니거나 포트가 닫혀 있으면 null */
  dongle: DongleLink | null;
  pedal: PedalLive;
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
  /** 마지막 보정 또는 재정렬을 마친 시각(Date.now, 표시용). 아직 안 했으면 null. 세션 값 */
  referenceSetAt: number | null;
  /** 보정 뒤 센서 연결이 끊겼다 — 재연결 후 다시 맞추라는 안내용 */
  referenceStale: boolean;
  /** 일시정지 요청. E0 사이드바가 'menu'로 올리면 곡 연주 페이지가 일시정지하고 null로 되돌린다 */
  pauseRequested: 'menu' | null;
  /** 손별로 스틱에 보낸 패드 표 적용 상태. 보낸 적 없거나 연결이 끊기면 null */
  padTable: [PadTableStatus | null, PadTableStatus | null];
  /** 재정렬이 필요한 손(비트 5 재연결·버튼 보정을 받았고 앵커가 있는 손). 재정렬하거나 건너뛰면 끈다 */
  realignNeeded: [boolean, boolean];
  /** 보정·재정렬 세션 스냅샷 */
  calibration: CalibrationSnapshot;
  /** 스틱별 방위각 드리프트 보정 상태. 연결 안 됐거나 소스가 보정을 못 하면 null */
  yawDrift: [YawDriftStatus | null, YawDriftStatus | null];
  /** 기기 사이 시각 차이 경고(PLAY-006). 경고 중이 아니면 null. runtime/arrivalSkewWatch가 알리면 bootstrap이 옮긴다 */
  clockSkew: ClockSkew | null;
}

export const useLive = create<LiveState>(() => ({
  connected: [false, false],
  battery: [null, null],
  dongle: null,
  pedal: initialPedal(),
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
  padTable: [null, null],
  realignNeeded: [false, false],
  calibration: IDLE_CALIBRATION,
  yawDrift: [null, null],
  clockSkew: null,
}));
