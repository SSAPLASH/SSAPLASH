// 보정·재정렬 세션 검증(PLAY-004 3-7): 시작·완료·중단 부작용 순서, 타격 가로채기(소리는 목표 패드), 버튼 보정·재정렬.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrationSession } from './calibrationSession';
import { inputManager } from './sources';
import { BaseInputSource } from '@/input/source/InputSource';
import { padTableSync } from '@/input/padTableSync';
import { yawDriftMonitor } from '@/input/yawDriftMonitor';
import { audioEngine } from '@/audio/AudioEngine';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { CAPTURE_ORDER } from '@/engine/HitCapture';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { SYSTEM_PRESET_ID } from '@/domain/kit/preset';
import type { InputSourceKind, ResolvedHit, SourceState, StickId } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';

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
let deps: { setSoundOnHit: ReturnType<typeof vi.fn>; pushTable: ReturnType<typeof vi.fn>; noteMinPeakCapture: ReturnType<typeof vi.fn> };
let trigger: ReturnType<typeof spyTrigger>;
const spyTrigger = () => vi.spyOn(audioEngine, 'trigger');

const clears = () => src.sent.filter((s) => s.bytes[0] === 0x15 && s.bytes[1] === 0x80);
const yawOffsets = () => src.sent.filter((s) => s.bytes[0] === 0x16);
const sentDeg = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset).getInt16(1, true) / 100;

/** 손 h가 자세 p로 두 번 친다 */
function twice(h: StickId, pitch: number, yaw: number, over: Partial<ResolvedHit> = {}) {
  expect(calibrationSession.intercept(hit(h, pitch, yaw, over))).toBe(true);
  expect(calibrationSession.intercept(hit(h, pitch, yaw + 1, over))).toBe(true);
}

/** 자동 진행 지연(400ms)을 넘긴다. 호출하는 테스트는 vi.useFakeTimers()를 먼저 켠다 */
const tick = () => vi.advanceTimersByTime(400);

/** 7패드를 손마다 채우고 패드마다 자동 진행을 기다린다(패드끼리 약 30° 떨어져 간격 경고 없음). 끝나면 done이라 [저장](finish)은 호출자가 */
function fillAll(hands: StickId[], over: Partial<ResolvedHit> = {}) {
  if (!vi.isFakeTimers()) vi.useFakeTimers();
  CAPTURE_ORDER.forEach((_, i) => {
    // 라이드는 오른손만 받는다(PLAY-004 ①). 왼손이 쳐도 가로채기는 true지만 앵커는 안 잡힌다
    for (const h of hands) twice(h, -10 + i * 5, (h === 0 ? -40 : -20) + i * 30, over);
    tick();
  });
}

const cap = () => useLive.getState().calibration.capture;

beforeEach(async () => {
  calibrationSession.resetForTest();
  padTableSync.reset();
  yawDriftMonitor.resetAll();
  src = new MockSource();
  await inputManager.attach(src);
  padTableSync.setSource(src);
  yawDriftMonitor.setSource(src);
  src.set('connected');
  // 사용자 프리셋 'p'가 적용 중(시스템 기본이면 'active' 보정이 열리지 않는다, UX-64 D6)
  useSettings.setState({ stickAnchors: [null, null], calibratedAt: null, kitLayout: DEFAULT_KIT_LAYOUT, activePresetId: 'p', presetAnchors: {} });
  useLive.setState({ activeSensor: 'ble', connected: [true, true], realignNeeded: [false, false], referenceSetAt: null });
  deps = { setSoundOnHit: vi.fn(), pushTable: vi.fn(), noteMinPeakCapture: vi.fn() };
  calibrationSession.bind(deps);
  trigger = spyTrigger().mockReturnValue(123);
});

afterEach(async () => {
  vi.useRealTimers();
  trigger.mockRestore();
  await inputManager.detach('ble');
  calibrationSession.resetForTest();
});

describe('2타 보정 시작', () => {
  it('RESET_POSE → 드리프트 감시 pause → 손마다 지우기 전용 표 → 소리 끄기 → capturing(HIHAT)', () => {
    calibrationSession.startCapture();
    expect(src.resets).toBe(1);
    expect(yawDriftMonitor.isPaused).toBe(true);
    expect(clears().map((s) => s.stickId)).toEqual([0, 1]);
    expect(deps.setSoundOnHit).toHaveBeenCalledWith(false);
    const snap = useLive.getState().calibration;
    expect(snap.mode).toBe('capture');
    expect(snap.hands).toEqual([0, 1]);
    expect(snap.target).toBe('active');
    expect(snap.capture?.target).toBe('HIHAT');
  });

  it("시스템 기본이 적용 중이면 'active' 보정은 무동작, 'new'(추가하기)는 열린다(UX-64 D6)", () => {
    useSettings.setState({ activePresetId: SYSTEM_PRESET_ID });
    calibrationSession.startCapture();
    expect(useLive.getState().calibration.mode).toBe('idle');
    calibrationSession.startCapture({ target: 'new' });
    expect(useLive.getState().calibration).toMatchObject({ mode: 'capture', target: 'new' });
    expect(cap()?.order).toEqual([...CAPTURE_ORDER]);
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
    expect(calibrationSession.intercept(hit(0, -10, 0, { pad: 'SNARE' }))).toBe(true);
    expect(trigger).toHaveBeenCalledWith('HIHAT', 90);
    expect(useLive.getState().lastHit?.pad).toBe('HIHAT');
    expect(useLive.getState().calibration.capture?.counts).toEqual([1, 0]);
  });

  it('키보드·페달 타격은 가로채지 않는다', () => {
    calibrationSession.startCapture();
    expect(calibrationSession.intercept(hit(0, 0, 0, { source: 'keyboard' }))).toBe(false);
    expect(calibrationSession.intercept(hit(null, 0, 0, { foot: 3, pad: 'KICK' }))).toBe(false);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('패드를 채우는 두 번째 타격도 그 패드 소리이고, 자동 진행 대기 중 타격·이미 찬 손의 타격도 목표 패드 소리', () => {
    vi.useFakeTimers();
    useLive.setState({ connected: [true, false] });
    calibrationSession.startCapture();
    calibrationSession.intercept(hit(0, -10, 0));
    calibrationSession.intercept(hit(0, -10, 1)); // 하이햇 완료 → 자동 진행 대기
    expect(cap()).toMatchObject({ phase: 'padDone', advancing: true, target: 'HIHAT' });
    expect(calibrationSession.intercept(hit(0, -10, 1))).toBe(true); // 대기 중 타격은 가로채되 세지 않는다
    expect(trigger.mock.calls.map((c) => c[0])).toEqual(['HIHAT', 'HIHAT', 'HIHAT']);
    expect(cap()?.counts).toEqual([2, 0]);
    trigger.mockClear();
    tick(); // 자동 진행 → 크래시
    expect(cap()?.target).toBe('CRASH');
    useLive.setState({ connected: [true, true] });
    calibrationSession.onHandConnected(1);
    calibrationSession.intercept(hit(0, 0, -50));
    calibrationSession.intercept(hit(0, 0, -49));
    calibrationSession.intercept(hit(0, 0, -49)); // 왼손은 찼다 — 오른손 대기
    expect(trigger.mock.calls.map((c) => c[0])).toEqual(['CRASH', 'CRASH', 'CRASH']);
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

describe('보정 완료([저장] = finish)', () => {
  it("'active': 마지막 패드 자동 진행 뒤 done에서 멈추고, finish()가 손별 앵커·시각 저장(사본 + 프리셋 기록) → 배치 유도 → resume → 소리 켜기 → referenceSetAt·realignNeeded 해제", () => {
    useLive.setState({ realignNeeded: [true, false] });
    calibrationSession.startCapture();
    fillAll([0, 1]);
    // 아직 저장 전: done에서 대기, 앵커는 비어 있다
    expect(cap()?.phase).toBe('done');
    expect(useLive.getState().calibration.mode).toBe('capture');
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
    expect(calibrationSession.finish()).toBeNull();
    const s = useSettings.getState();
    expect(s.stickAnchors[0]?.HIHAT?.yaw).toBeCloseTo(-39.5);
    expect(s.stickAnchors[1]?.HIHAT?.yaw).toBeCloseTo(-19.5);
    expect(Object.keys(s.stickAnchors[0]!)).toHaveLength(7);
    expect(s.calibratedAt).not.toBeNull();
    expect(s.presetAnchors.p?.anchors[0]?.HIHAT?.yaw).toBeCloseTo(-39.5);
    expect(s.kitLayout).not.toEqual(DEFAULT_KIT_LAYOUT);
    expect(s.kitLayout.KICK).toEqual(DEFAULT_KIT_LAYOUT.KICK);
    expect(yawDriftMonitor.isPaused).toBe(false);
    expect(deps.setSoundOnHit).toHaveBeenLastCalledWith(true);
    const live = useLive.getState();
    expect(live.calibration.mode).toBe('idle');
    expect(live.referenceSetAt).not.toBeNull();
    expect(live.realignNeeded).toEqual([false, false]);
  });

  it('done이 아니면 finish()는 무동작(null)', () => {
    calibrationSession.startCapture();
    twice(0, -10, 0);
    expect(calibrationSession.finish()).toBeNull();
    expect(useLive.getState().calibration.mode).toBe('capture');
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
  });

  it("'new': finish()가 초안(앵커·기본 배치에서 유도한 배치·시각)을 돌려주고 세션을 접는다. 설정은 그대로(UX-64 D4)", () => {
    useSettings.setState({ activePresetId: SYSTEM_PRESET_ID, kitLayout: DEFAULT_KIT_LAYOUT });
    calibrationSession.startCapture({ target: 'new' });
    fillAll([0, 1]);
    calibrationSession.setRadiusOverride('SNARE', 30);
    const draft = calibrationSession.finish()!;
    expect(draft).not.toBeNull();
    expect(draft.anchors[0]?.SNARE).toMatchObject({ radiusOverride: 30, radius: 30 });
    expect(Object.keys(draft.anchors[1]!)).toHaveLength(7);
    expect(draft.layout.SNARE).not.toEqual(DEFAULT_KIT_LAYOUT.SNARE);
    expect(draft.layout.KICK).toEqual(DEFAULT_KIT_LAYOUT.KICK);
    expect(draft.calibratedAt).toBeGreaterThan(0);
    // 저장 전까지 아무것도 바뀌지 않는다. 표는 적용 프리셋 것으로 복구(force)
    const s = useSettings.getState();
    expect(s.stickAnchors).toEqual([null, null]);
    expect(s.kitLayout).toEqual(DEFAULT_KIT_LAYOUT);
    expect(s.activePresetId).toBe(SYSTEM_PRESET_ID);
    expect(deps.pushTable.mock.calls).toEqual([
      [0, true],
      [1, true],
    ]);
    expect(useLive.getState().calibration).toMatchObject({ mode: 'idle', target: null });
    expect(deps.setSoundOnHit).toHaveBeenLastCalledWith(true);
    expect(yawDriftMonitor.isPaused).toBe(false);
  });

  it('한 손만 보정하면 그 손만 채우고 다른 손의 이전 앵커는 유지된다', () => {
    useSettings.setState({ stickAnchors: [null, { SNARE: anchor('SNARE', -20, 5) }] });
    useLive.setState({ connected: [true, false] });
    calibrationSession.startCapture();
    fillAll([0]);
    calibrationSession.finish();
    const s = useSettings.getState();
    expect(s.stickAnchors[0]).not.toBeNull();
    // 왼손만 친 라이드의 오른손 앵커는 스네어 양손 차이로 만들어 얹는다(PLAY-004 ①). 나머지 이전 앵커는 그대로
    expect(s.stickAnchors[1]?.SNARE).toMatchObject({ pitch: -20, yaw: 5, samples: 2 });
    expect(Object.keys(s.stickAnchors[1]!).sort()).toEqual(['RIDE', 'SNARE']);
    expect(s.stickAnchors[1]?.RIDE?.derived).toBe(true);
  });

  it('전체 보정 저장 뒤 왼손 라이드는 오른손 라이드 + 스네어 양손 차이로 만든 derived 앵커다(PLAY-004 ①)', () => {
    calibrationSession.startCapture();
    fillAll([0, 1]);
    // 라이드는 오른손이 2타만 쳐도 끝나 done이다(왼손 라이드 타격은 받지 않았다)
    expect(cap()?.phase).toBe('done');
    calibrationSession.finish();
    const [l, r] = useSettings.getState().stickAnchors;
    expect(r?.RIDE?.derived).toBeUndefined();
    expect(l?.RIDE).toMatchObject({ derived: true, samples: 0, spread: 0 });
    // 왼손 SNARE(-0, 인덱스 2): pitch 0, yaw 20 평균 → 오른손 SNARE yaw 40 평균. 차이를 오른손 라이드에 옮긴다
    const dPitch = l!.SNARE!.pitch - r!.SNARE!.pitch;
    const dYaw = l!.SNARE!.yaw - r!.SNARE!.yaw;
    expect(l!.RIDE!.pitch).toBeCloseTo(r!.RIDE!.pitch + dPitch, 1);
    expect(l!.RIDE!.yaw).toBeCloseTo(r!.RIDE!.yaw + dYaw, 1);
    expect(l!.RIDE!.radius).toBeGreaterThan(0);
  });

  it("'new' 초안에도 왼손 라이드 derived 앵커가 들어간다", () => {
    useSettings.setState({ activePresetId: SYSTEM_PRESET_ID });
    calibrationSession.startCapture({ target: 'new' });
    fillAll([0, 1]);
    const draft = calibrationSession.finish()!;
    expect(draft.anchors[0]?.RIDE?.derived).toBe(true);
    expect(draft.anchors[1]?.RIDE?.derived).toBeUndefined();
  });

  it('손별 최소 타격 세기: 보정 타격 중앙값 × 0.4를 저장하고, 6타 미만인 손은 그대로 둔다(PLAY-004 ③)', () => {
    useSettings.setState({ stickMinPeak: [null, 300] });
    calibrationSession.startCapture();
    fillAll([0, 1], { peakSpeedDps: 800 });
    calibrationSession.finish();
    // 왼손은 라이드를 빼고 6패드 × 2타 + 라이드 왼손 2타(다시 친 것 포함) = 14타, 800 → 320
    expect(useSettings.getState().stickMinPeak).toEqual([320, 320]);
    expect(deps.noteMinPeakCapture).toHaveBeenCalledWith(0, 800, 14);
    expect(deps.noteMinPeakCapture).toHaveBeenCalledWith(1, 800, 14);
  });

  it('표본이 6타 미만인 손은 최소 타격 세기를 바꾸지 않는다', () => {
    useSettings.setState({ stickMinPeak: [null, 300] });
    useLive.setState({ connected: [false, true] });
    calibrationSession.startCapture({ pads: ['SNARE'] });
    twice(1, -10, 0, { peakSpeedDps: 900 });
    calibrationSession.finish();
    expect(useSettings.getState().stickMinPeak).toEqual([null, 300]);
    expect(deps.noteMinPeakCapture).not.toHaveBeenCalled();
  });

  it('보정 중 반지름 슬라이더(setRadiusOverride)는 저장 때 합쳐진 앵커에 남고 반경을 자른다', () => {
    calibrationSession.startCapture();
    fillAll([0, 1]);
    calibrationSession.setRadiusOverride('HIHAT', 1);
    calibrationSession.finish();
    const s = useSettings.getState();
    expect(s.stickAnchors[0]?.HIHAT).toMatchObject({ radiusOverride: 1, radius: 15 });
    expect(s.stickAnchors[1]?.HIHAT?.radius).toBe(15);
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

  it('대상 손이 모두 끊기면 중단, 한 손만 끊기면 남은 손으로 계속(남은 손이 찼으면 자동 진행 대기)', () => {
    calibrationSession.startCapture();
    twice(0, -10, 0);
    calibrationSession.onHandDisconnected(1);
    expect(useLive.getState().calibration.hands).toEqual([0]);
    expect(cap()).toMatchObject({ phase: 'padDone', advancing: true, target: 'HIHAT' });
    expect(useSettings.getState().stickAnchors).toEqual([null, null]);
    calibrationSession.onHandDisconnected(0);
    expect(useLive.getState().calibration.mode).toBe('idle');
    // 끊긴 손에는 보낼 수 없다. 다시 붙으면 bootstrap이 표를 보낸다. 소리·감시는 되돌린다
    expect(deps.setSoundOnHit).toHaveBeenLastCalledWith(true);
    expect(yawDriftMonitor.isPaused).toBe(false);
  });

  it('보정 중 스틱 버튼 보정(0x22 button)은 처음부터 다시', () => {
    vi.useFakeTimers();
    calibrationSession.startCapture();
    twice(0, -10, 0);
    twice(1, -10, 50);
    tick();
    expect(useLive.getState().calibration.capture?.target).toBe('CRASH');
    calibrationSession.onResetPose('button', 1);
    expect(useLive.getState().calibration.capture).toMatchObject({ phase: 'capturing', target: 'HIHAT', counts: [0, 0] });
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

describe('시작 위치 잡기(resetPose, UX-64 D7)', () => {
  it('idle에서 RESET_POSE를 보내고 referenceSetAt을 찍으며 재정렬 필요를 끈다. 보정 중에는 무동작', () => {
    useLive.setState({ realignNeeded: [true, false] });
    calibrationSession.resetPose();
    expect(src.resets).toBe(1);
    expect(useLive.getState().referenceSetAt).not.toBeNull();
    expect(useLive.getState().realignNeeded).toEqual([false, false]);
    calibrationSession.startCapture();
    calibrationSession.resetPose();
    expect(src.resets).toBe(2); // startCapture의 1회뿐
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

describe('패드 단위 재보정(T9)', () => {
  it('startCapture([pad])는 그 패드만 받고, 완료 시 그 손들의 그 패드 앵커만 바꾸며 나머지는 유지한다', () => {
    useSettings.setState({
      stickAnchors: [
        { SNARE: anchor('SNARE', -20, -10), HIHAT: anchor('HIHAT', -5, -40) },
        { SNARE: anchor('SNARE', -20, 10), HIHAT: anchor('HIHAT', -5, -20) },
      ],
    });
    vi.useFakeTimers();
    calibrationSession.startCapture({ pads: ['HIHAT'] });
    expect(useLive.getState().calibration.capture).toMatchObject({ target: 'HIHAT', order: ['HIHAT'] });
    expect(clears().map((s) => s.stickId)).toEqual([0, 1]);
    twice(0, 0, -30);
    twice(1, 0, -25);
    tick();
    expect(cap()?.phase).toBe('done');
    calibrationSession.finish();
    const s = useSettings.getState();
    expect(useLive.getState().calibration.mode).toBe('idle');
    expect(s.stickAnchors[0]?.SNARE).toMatchObject({ pitch: -20, yaw: -10 });
    expect(s.stickAnchors[0]?.HIHAT?.yaw).toBeCloseTo(-29.5);
    expect(s.stickAnchors[1]?.HIHAT?.yaw).toBeCloseTo(-24.5);
    expect(s.stickAnchors[1]?.SNARE?.yaw).toBe(10);
    // 반경은 합친 집합으로 다시 계산돼 하한 이상
    expect(s.stickAnchors[0]?.HIHAT?.radius).toBeGreaterThanOrEqual(15);
    // 배치는 이번에 친 하이햇만 옮기고 나머지는 현재 배치 그대로
    expect(s.kitLayout.SNARE).toEqual(DEFAULT_KIT_LAYOUT.SNARE);
    expect(s.kitLayout.HIHAT).not.toEqual(DEFAULT_KIT_LAYOUT.HIHAT);
    expect(deps.setSoundOnHit).toHaveBeenLastCalledWith(true);
  });

  it('패드 단위 재보정은 적용 프리셋의 다른 패드 앵커를 base로 넘겨 간격 경고한다. 전체 보정은 비교 대상이 없다', () => {
    vi.useFakeTimers();
    useSettings.setState({
      stickAnchors: [
        { SNARE: anchor('SNARE', 0, 0), HIHAT: anchor('HIHAT', 0, 100) },
        { SNARE: anchor('SNARE', 0, 50), HIHAT: anchor('HIHAT', 0, 100) },
      ],
    });
    calibrationSession.startCapture({ pads: ['HIHAT'] });
    twice(0, 0, 10); // 왼손 스네어(0°)와 10°
    twice(1, 0, 100); // 오른손은 멀다
    // 경고가 있어도 멈추지 않는다(v0.2): 자동 진행 대기 → 마지막 패드라 done, 경고는 남는다. base(세션 밖 앵커)도 스냅샷에 실린다
    expect(cap()).toMatchObject({ phase: 'padDone', advancing: true });
    expect(cap()?.base[0]?.SNARE).toBeDefined();
    expect(cap()?.gapWarnings).toEqual([expect.objectContaining({ stickId: 0, pad: 'HIHAT', near: 'SNARE' })]);
    vi.advanceTimersByTime(400);
    expect(cap()?.phase).toBe('done');
    expect(cap()?.gapWarnings).toHaveLength(1);
    calibrationSession.cancelCapture();

    // 전체 보정(pads 없음)은 base 없이 시작: 같은 자리를 쳐도 첫 패드는 경고 없음
    calibrationSession.startCapture();
    vi.useFakeTimers();
    twice(0, 0, 10);
    twice(1, 0, 100);
    expect(cap()).toMatchObject({ phase: 'padDone', advancing: true, gapWarnings: [] });
  });

  it('보정을 마치거나 취소하면 자동 진행 타이머가 정리된다', () => {
    vi.useFakeTimers();
    useLive.setState({ connected: [true, false] });
    calibrationSession.startCapture();
    twice(0, -10, 0);
    calibrationSession.cancelCapture();
    vi.advanceTimersByTime(1000);
    expect(cap()?.phase).not.toBe('capturing'); // idle로 접혔고 늦게 진행하지 않는다
    expect(useLive.getState().calibration.mode).toBe('idle');
  });
});
