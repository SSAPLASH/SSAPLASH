// 보정·재정렬 세션 검증(PLAY-004 3-7): 시작·완료·중단 부작용 순서, 타격 가로채기(소리는 목표 패드), 버튼 보정·재정렬.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrationSession } from './calibrationSession';
import { inputManager } from './sources';
import { BaseInputSource } from '@/input/InputSource';
import { padTableSync } from '@/input/padTableSync';
import { yawDriftMonitor } from '@/input/yawDriftMonitor';
import { audioEngine } from '@/audio/AudioEngine';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { CAPTURE_ORDER } from '@/engine/HitCapture';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kitLayout';
import type { InputSourceKind, ResolvedHit, SourceState, StickId } from '@/domain/events';
import type { PadId } from '@/domain/pads';

/** BLE형 모의 소스: 보낸 명령과 resetPose 호출을 기록한다 */
class MockSource extends BaseInputSource {
  readonly kind = 'ble' as InputSourceKind;
  readonly label = 'mock';
  sent: { bytes: Uint8Array; stickId?: StickId }[] = [];
  resets = 0;
  sendCommand(bytes: Uint8Array, stickId?: StickId): void {
    this.sent.push({ bytes, stickId });
  }
  resetPose(): void {
    this.resets++;
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  set(s: SourceState): void {
    this.setState(s);
  }
}

const hit = (stickId: StickId | null, pitch: number, yaw: number, over: Partial<ResolvedHit> = {}): ResolvedHit => ({
  id: 1,
  stickId,
  pad: 'CRASH',
  velocity: 90,
  tHit: 10,
  tRecv: 10,
  tResolved: 10,
  source: 'ble',
  pose: { pitch, yaw },
  peakAccel: 5,
  judgedBy: 'stick',
  ...over,
});

const anchor = (pad: PadId, pitch: number, yaw: number) => ({ pad, pitch, yaw, radius: 18, samples: 2, spread: 1 });

let src: MockSource;
let deps: { setSoundOnHit: ReturnType<typeof vi.fn>; pushTable: ReturnType<typeof vi.fn> };
let trigger: ReturnType<typeof spyTrigger>;
const spyTrigger = () => vi.spyOn(audioEngine, 'trigger');

const clears = () => src.sent.filter((s) => s.bytes[0] === 0x15 && s.bytes[1] === 0x80);
const yawOffsets = () => src.sent.filter((s) => s.bytes[0] === 0x16);
const sentDeg = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset).getInt16(1, true) / 100;

/** 손 h가 자세 p로 두 번 친다 */
function twice(h: StickId, pitch: number, yaw: number) {
  expect(calibrationSession.intercept(hit(h, pitch, yaw))).toBe(true);
  expect(calibrationSession.intercept(hit(h, pitch, yaw + 1))).toBe(true);
}

function fillAll(hands: StickId[]) {
  CAPTURE_ORDER.forEach((_, i) => {
    for (const h of hands) twice(h, -10 + i * 5, (h === 0 ? -40 : -20) + i * 12);
  });
}

beforeEach(async () => {
  calibrationSession.resetForTest();
  padTableSync.reset();
  yawDriftMonitor.resetAll();
  src = new MockSource();
  await inputManager.attach(src);
  padTableSync.setSource(src);
  yawDriftMonitor.setSource(src);
  src.set('connected');
  useSettings.setState({ stickAnchors: [null, null], calibratedAt: null, kitLayout: DEFAULT_KIT_LAYOUT });
  useLive.setState({ activeSensor: 'ble', connected: [true, true], realignNeeded: [false, false], referenceSetAt: null });
  deps = { setSoundOnHit: vi.fn(), pushTable: vi.fn() };
  calibrationSession.bind(deps);
  trigger = spyTrigger().mockReturnValue(123);
});

afterEach(async () => {
  trigger.mockRestore();
  await inputManager.detach('ble');
  calibrationSession.resetForTest();
});

describe('2타 보정 시작', () => {
  it('RESET_POSE → 드리프트 감시 pause → 손마다 지우기 전용 표 → 소리 끄기 → capturing(SNARE)', () => {
    calibrationSession.startCapture();
    expect(src.resets).toBe(1);
    expect(yawDriftMonitor.isPaused).toBe(true);
    expect(clears().map((s) => s.stickId)).toEqual([0, 1]);
    expect(deps.setSoundOnHit).toHaveBeenCalledWith(false);
    const snap = useLive.getState().calibration;
    expect(snap.mode).toBe('capture');
    expect(snap.hands).toEqual([0, 1]);
    expect(snap.capture?.target).toBe('SNARE');
  });

  it('한 손만 연결이면 그 손만 대상', () => {
    useLive.setState({ connected: [false, true] });
    calibrationSession.startCapture();
    expect(useLive.getState().calibration.hands).toEqual([1]);
    expect(clears().map((s) => s.stickId)).toEqual([1]);
  });

  it('센서가 없거나 연결된 손이 없으면 무동작', () => {
    useLive.setState({ connected: [false, false] });
    calibrationSession.startCapture();
    expect(useLive.getState().calibration.mode).toBe('idle');
    useLive.setState({ activeSensor: 'none', connected: [true, true] });
    calibrationSession.startCapture();
    expect(useLive.getState().calibration.mode).toBe('idle');
  });
});

describe('보정 중 타격 가로채기', () => {
  it('센서 손 타격은 전부 가로채고, 소리·표시는 스틱 pad가 아니라 목표 패드', () => {
    calibrationSession.startCapture();
    expect(calibrationSession.intercept(hit(0, -10, 0, { pad: 'HIHAT' }))).toBe(true);
    expect(trigger).toHaveBeenCalledWith('SNARE', 90);
    expect(useLive.getState().lastHit?.pad).toBe('SNARE');
    expect(useLive.getState().calibration.capture?.counts).toEqual([1, 0]);
  });

  it('키보드·페달 타격은 가로채지 않는다', () => {
    calibrationSession.startCapture();
    expect(calibrationSession.intercept(hit(0, 0, 0, { source: 'keyboard' }))).toBe(false);
    expect(calibrationSession.intercept(hit(null, 0, 0, { foot: 3, pad: 'KICK' }))).toBe(false);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('단계를 넘기는 두 번째 타격도 이전 패드 소리이고, 이미 찬 손의 타격도 목표 패드 소리', () => {
    useLive.setState({ connected: [true, false] });
    calibrationSession.startCapture();
    calibrationSession.intercept(hit(0, -10, 0));
    calibrationSession.intercept(hit(0, -10, 1)); // 스네어 완료 → 하이햇으로
    expect(trigger.mock.calls.map((c) => c[0])).toEqual(['SNARE', 'SNARE']);
    expect(useLive.getState().calibration.capture?.target).toBe('HIHAT');
    useLive.setState({ connected: [true, true] });
    calibrationSession.onHandConnected(1);
    calibrationSession.intercept(hit(0, 0, -30));
    calibrationSession.intercept(hit(0, 0, -29));
    calibrationSession.intercept(hit(0, 0, -29)); // 왼손은 찼다 — 오른손 대기
    expect(trigger.mock.calls.map((c) => c[0]).slice(2)).toEqual(['HIHAT', 'HIHAT', 'HIHAT']);
  });

  it('패드를 채우면 그 패드를 채운 손마다 햅틱', () => {
    const haptic = vi.spyOn(inputManager, 'haptic');
    calibrationSession.startCapture();
    twice(0, -10, 0);
    expect(haptic).not.toHaveBeenCalled();
    twice(1, -10, 10);
    expect(haptic.mock.calls.map((c) => c[0])).toEqual([0, 1]);
    haptic.mockRestore();
  });
});

describe('보정 완료', () => {
  it('손별 앵커·시각 저장 → 배치 유도 → 드리프트 resume → 소리 켜기 → referenceSetAt·realignNeeded 해제', () => {
    useLive.setState({ realignNeeded: [true, false] });
    calibrationSession.startCapture();
    fillAll([0, 1]);
    const s = useSettings.getState();
    expect(s.stickAnchors[0]?.SNARE?.yaw).toBeCloseTo(-39.5);
    expect(s.stickAnchors[1]?.SNARE?.yaw).toBeCloseTo(-19.5);
    expect(Object.keys(s.stickAnchors[0]!)).toHaveLength(7);
    expect(s.calibratedAt).not.toBeNull();
    expect(s.kitLayout).not.toEqual(DEFAULT_KIT_LAYOUT);
    expect(s.kitLayout.KICK).toEqual(DEFAULT_KIT_LAYOUT.KICK);
    expect(yawDriftMonitor.isPaused).toBe(false);
    expect(deps.setSoundOnHit).toHaveBeenLastCalledWith(true);
    const live = useLive.getState();
    expect(live.calibration.mode).toBe('idle');
    expect(live.referenceSetAt).not.toBeNull();
    expect(live.realignNeeded).toEqual([false, false]);
  });

  it('한 손만 보정하면 그 손만 채우고 다른 손의 이전 앵커는 유지된다', () => {
    useSettings.setState({ stickAnchors: [null, { SNARE: anchor('SNARE', -20, 5) }] });
    useLive.setState({ connected: [true, false] });
    calibrationSession.startCapture();
    fillAll([0]);
    const s = useSettings.getState();
    expect(s.stickAnchors[0]).not.toBeNull();
    expect(s.stickAnchors[1]).toEqual({ SNARE: anchor('SNARE', -20, 5) });
  });
});

describe('보정 취소·중단·버튼', () => {
  it('취소하면 표 재전송(force)·resume·소리 켜기·idle', () => {
    calibrationSession.startCapture();
    twice(0, -10, 0);
    calibrationSession.cancelCapture();
    expect(deps.pushTable.mock.calls).toEqual([
      [0, true],
      [1, true],
    ]);
    expect(yawDriftMonitor.isPaused).toBe(false);
    expect(deps.setSoundOnHit).toHaveBeenLastCalledWith(true);
    expect(useLive.getState().calibration.mode).toBe('idle');
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
  });

  it('대상 손이 모두 끊기면 중단, 한 손만 끊기면 남은 손으로 계속', () => {
    calibrationSession.startCapture();
    calibrationSession.onHandDisconnected(1);
    expect(useLive.getState().calibration.hands).toEqual([0]);
    calibrationSession.onHandDisconnected(0);
    expect(useLive.getState().calibration.mode).toBe('idle');
    // 끊긴 손에는 보낼 수 없다. 다시 붙으면 bootstrap이 표를 보낸다. 소리·감시는 되돌린다
    expect(deps.setSoundOnHit).toHaveBeenLastCalledWith(true);
    expect(yawDriftMonitor.isPaused).toBe(false);
  });

  it('보정 중 스틱 버튼 보정(0x22 button)은 처음부터 다시', () => {
    calibrationSession.startCapture();
    twice(0, -10, 0);
    twice(1, -10, 5);
    expect(useLive.getState().calibration.capture?.target).toBe('HIHAT');
    calibrationSession.onResetPose('button', 1);
    expect(useLive.getState().calibration.capture).toMatchObject({ phase: 'capturing', target: 'SNARE', counts: [0, 0] });
  });

  it('보정 중이 아닐 때 버튼 보정은 앵커가 있는 손만 재정렬 필요로. FE 요청(fe)은 무시', () => {
    useSettings.setState({ stickAnchors: [null, { SNARE: anchor('SNARE', -20, 5) }] });
    calibrationSession.onResetPose('button', 0);
    expect(useLive.getState().realignNeeded).toEqual([false, false]);
    calibrationSession.onResetPose('button', 1);
    expect(useLive.getState().realignNeeded).toEqual([false, true]);
    useLive.setState({ realignNeeded: [false, false] });
    calibrationSession.onResetPose('fe', null);
    expect(useLive.getState().realignNeeded).toEqual([false, false]);
  });
});

describe('스네어 재정렬', () => {
  beforeEach(() => {
    useSettings.setState({ stickAnchors: [{ SNARE: anchor('SNARE', -20, -20) }, { SNARE: anchor('SNARE', -20, 10) }] });
  });

  it('realignNeeded가 켜진 손만 대상. 대상 아닌 손의 타격은 가로채지 않는다', () => {
    useLive.setState({ realignNeeded: [true, false] });
    calibrationSession.startRealign();
    expect(yawDriftMonitor.isPaused).toBe(true);
    expect(useLive.getState().calibration).toMatchObject({ mode: 'realign', hands: [0] });
    expect(calibrationSession.intercept(hit(1, -20, 10))).toBe(false);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('대상 손의 스네어 1타 → SNARE 소리, SET_YAW_OFFSET(적용값 − d), realignNeeded 해제, 끝나면 resume·referenceSetAt', () => {
    useLive.setState({ realignNeeded: [true, false] });
    calibrationSession.startRealign();
    expect(calibrationSession.intercept(hit(0, -20, -14, { pad: 'HIHAT' }))).toBe(true);
    expect(trigger).toHaveBeenCalledWith('SNARE', 90);
    expect(yawOffsets()).toHaveLength(1);
    expect(yawOffsets()[0].stickId).toBe(0);
    expect(sentDeg(yawOffsets()[0].bytes)).toBeCloseTo(-6);
    const live = useLive.getState();
    expect(live.realignNeeded).toEqual([false, false]);
    expect(live.calibration.mode).toBe('idle');
    expect(live.referenceSetAt).not.toBeNull();
    expect(yawDriftMonitor.isPaused).toBe(false);
  });

  it('hands 생략·realignNeeded 없음이면 앵커가 있고 연결된 손 전부', () => {
    useLive.setState({ connected: [true, true] });
    calibrationSession.startRealign();
    expect(useLive.getState().calibration.hands).toEqual([0, 1]);
    calibrationSession.intercept(hit(0, -20, -20));
    expect(useLive.getState().calibration.mode).toBe('realign');
    calibrationSession.intercept(hit(1, -20, 13));
    expect(useLive.getState().calibration.mode).toBe('idle');
    expect(yawOffsets().map((s) => sentDeg(s.bytes))).toEqual([0, -3]);
  });

  it('앵커가 없는 손은 대상에서 빠지고, 대상이 없으면 무동작', () => {
    useSettings.setState({ stickAnchors: [null, null] });
    calibrationSession.startRealign();
    expect(useLive.getState().calibration.mode).toBe('idle');
    expect(yawDriftMonitor.isPaused).toBe(false);
  });

  it('건너뛰기는 realignNeeded를 전부 끄고 resume, 취소는 realignNeeded를 남긴다', () => {
    useLive.setState({ realignNeeded: [true, true] });
    calibrationSession.startRealign();
    calibrationSession.cancelRealign();
    expect(useLive.getState().realignNeeded).toEqual([true, true]);
    expect(useLive.getState().calibration.mode).toBe('idle');
    calibrationSession.startRealign();
    calibrationSession.skipRealign();
    expect(useLive.getState().realignNeeded).toEqual([false, false]);
    expect(yawDriftMonitor.isPaused).toBe(false);
    expect(yawOffsets()).toHaveLength(0);
  });

  it('재정렬 중 보정 시작은 재정렬을 접고 보정으로 간다', () => {
    calibrationSession.startRealign();
    calibrationSession.startCapture();
    expect(useLive.getState().calibration.mode).toBe('capture');
  });
});
