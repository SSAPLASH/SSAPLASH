// 센서 소스 세션: 설정 sensorKind가 가리키는 센서 하나를 켜고 끄며, 그 인스턴스·입력 표면·배터리 기록·재연결 동작을 가진다.
// 화면은 activateSensor·connectSensor·bindSensorSurface를 부르고, 타격·상태 접착은 app/bootstrap이 아래 export를 읽어 한다.
import type { InputSource, SurfaceToPose } from '@/input/source/InputSource';
import { inputManager } from '@/runtime/sources';
import { resolveOptions, sensorRegistry } from '@/runtime/sensorRegistry';
import { useSettings } from '@/store/settingsStore';
import { initialPedal, useLive } from '@/store/liveStore';
import { setReconnectHandler } from '@/store/reconnectStore';
import { RECONNECT_WAIT_MS, hintFor, waitForDevices } from '@/runtime/reconnectPolicy';
import { audioEngine } from '@/audio/AudioEngine';
import type { SensorId, StickId } from '@/domain/events';
import { anchorsToProfile } from '@/domain/kit/kitJudge';
import { calibrationSession } from '@/runtime/calibrationSession';
import { padTableSync } from '@/input/padTableSync';
import { yawDriftMonitor } from '@/input/yawDriftMonitor';
import { pedalRequired } from '@/domain/kit/device/pedalStatus';
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import { MIN_PEAK_DEFAULT_DPS } from '@/domain/kit/calibration/tuning';
import { diagTap } from '@/engine/diagTap';

let currentSensor: SensorId = 'none';
/** 지금 연결된 센서 인스턴스. 'none'이면 null */
export let activeInstance: InputSource | null = null;
let unsubState: (() => void) | null = null;
let unsubDongle: (() => void) | null = null;
/** 손별 최근 배터리 측정값(평균용). 그 손이 끊기거나 센서가 바뀌면 비운다 */
export let batteryHistory: [number[], number[]] = [[], []];
/** 발별 최근 배터리 측정값(평균용). 두 발이 모두 끊기거나 센서가 바뀌면 비운다 */
export let pedalBatteryHistory: [number[], number[]] = [[], []];
/** 화면이 마지막으로 등록한 입력 표면. 센서가 바뀌어도 새 인스턴스에 다시 넘긴다 */
let lastSurface: HTMLElement | null = null;
let lastSurfaceToPose: SurfaceToPose | undefined;
/** 손별 마지막 설정 재전송 시각(비트 5 쿨다운, D5). 센서가 바뀌면 비운다 */
export const lastResendAt: [number | null, number | null] = [null, null];

/** 활성 센서의 디스크립터에 현재 설정값(기본값 병합)을 적용한다 */
export function applySensorOptions(): void {
  const desc = sensorRegistry.get(currentSensor);
  if (!desc || !activeInstance) return;
  const stored = useSettings.getState().sensorOptions[currentSensor];
  desc.applyOptions?.(activeInstance, resolveOptions(desc, stored));
  desc.applyTuning?.(activeInstance, useSettings.getState().tuning);
}

/** 현재 설정에서 유도한 손별 판정 프로필(PLAY-004 D1). 보정 안 된 손은 3D 모델 기본 앵커 */
export function currentProfiles(): [CalibrationProfile, CalibrationProfile] {
  const s = useSettings.getState();
  return [anchorsToProfile(s.stickAnchors[0], s.tuning, 0), anchorsToProfile(s.stickAnchors[1], s.tuning, 1)];
}

/** 그 손에 현재 프로필을 보낸다. 보정 중에는 표를 비워 둬야 하므로 보내지 않는다(D6) */
export function pushTable(stickId: StickId, force = false): void {
  if (calibrationSession.currentMode === 'capture') return;
  padTableSync.push(currentProfiles()[stickId], { stickId, force });
}

/** 손별로 마지막에 보낸 최소 타격 세기(°/s). 같은 값은 다시 보내지 않는다. 센서가 바뀌면 비운다 */
const lastMinPeakSent: [number | null, number | null] = [null, null];
/** 보정 저장이 남긴 계산 근거. 다음 pushMinPeak가 진단 줄에 싣고 비운다(저장 → 설정 변경 알림 → 전송 순서라 이유를 미리 적어 둔다) */
const pendingMinPeakNote: [{ medianDps: number; samples: number } | null, { medianDps: number; samples: number } | null] = [null, null];

/** 보정 저장 직전에 부른다: 이어지는 전송을 reason 'capture'로 남기게 근거를 적어 둔다 */
export function noteMinPeakCapture(stickId: StickId, medianDps: number, samples: number): void {
  pendingMinPeakNote[stickId] = { medianDps, samples };
}

export interface PushMinPeakOptions {
  /** 같은 값이어도 보낸다(손이 새로 붙을 때: 마지막에 보낸 값 기억이 맞지 않는다) */
  force?: boolean;
  /** 진단 줄의 이유. 없으면 보정 근거가 있으면 capture, 저장값이 없으면 reset, 아니면 linked */
  reason?: 'capture' | 'linked' | 'reset';
  medianDps?: number | null;
  samples?: number;
}

/**
 * 그 손에 최소 타격 세기를 보낸다(PLAY-004 ③). 값 = 저장값, 없으면 펌웨어 기본(400)을 보내 스틱에 남은 이전 사용자 값을 되돌린다.
 * 마지막에 보낸 값과 같으면 생략하고, 보낼 때마다 minPeak 진단 줄을 남긴다. 보정 캡처 중에도 보낸다(패드 표와 달리 막을 이유가 없다)
 */
export function pushMinPeak(stickId: StickId, opts: PushMinPeakOptions = {}): void {
  const stored = useSettings.getState().stickMinPeak[stickId];
  const dps = stored ?? MIN_PEAK_DEFAULT_DPS;
  const note = pendingMinPeakNote[stickId];
  pendingMinPeakNote[stickId] = null;
  if (!opts.force && lastMinPeakSent[stickId] === dps) return;
  lastMinPeakSent[stickId] = dps;
  inputManager.setMinPeak(stickId, dps);
  diagTap.publish({
    type: 'minPeak',
    stickId,
    dps,
    medianDps: opts.medianDps ?? note?.medianDps ?? null,
    samples: opts.samples ?? note?.samples ?? 0,
    reason: opts.reason ?? (note ? 'capture' : stored === null ? 'reset' : 'linked'),
  });
}

/** 센서 소스 교체. 키보드는 건드리지 않는다 */
export async function activateSensor(id: SensorId, auto = false): Promise<void> {
  if (currentSensor === id) return;
  if (activeInstance) await inputManager.detach(activeInstance.kind);
  unsubState?.();
  unsubState = null;
  unsubDongle?.();
  unsubDongle = null;
  batteryHistory = [[], []];
  pedalBatteryHistory = [[], []];
  lastResendAt[0] = lastResendAt[1] = null;
  lastMinPeakSent[0] = lastMinPeakSent[1] = null;
  activeInstance = null;
  padTableSync.setSource(null);
  yawDriftMonitor.setSource(null);
  currentSensor = id;
  // 이전 소스의 재연결 동작은 내린다. 새 소스가 준비되면 아래에서 다시 등록한다
  setReconnectHandler(null);
  audioEngine.setHihatOpen(false);
  useLive.setState({
    activeSensor: id,
    connected: [false, false],
    battery: [null, null],
    dongle: null,
    pedal: initialPedal(),
    sourceState: 'disconnected',
    sourceMessage: null,
  });
  if (id === 'none') return;
  try {
    const src = sensorRegistry.instance(id);
    activeInstance = src;
    padTableSync.setSource(src);
    yawDriftMonitor.setSource(src);
    applySensorOptions();
    src.setSurface?.(lastSurface, lastSurfaceToPose);
    unsubState = src.onState((s, message) => useLive.setState({ sourceState: s, sourceMessage: message ?? null }));
    unsubDongle = src.onDongle?.((link) => useLive.setState({ dongle: link })) ?? null;
    // 연결 개념이 없는 소스(포인터)는 autoConnect·reopen이 없어 핸들러를 등록하지 않는다 → [다시 연결]이 숨는다
    if (src.autoConnect || src.reopen) {
      setReconnectHandler((_attempt, signal) => reconnectAttempt(src, signal), hintFor(src.kind));
    }
    await inputManager.attach(src, auto);
  } catch (e) {
    useLive.setState({ sourceState: 'error', sourceMessage: (e as Error).message });
  }
}

/** 활성 센서를 사용자 클릭으로 다시 연다(동글 연결·다른 동글 연결). 클릭 처리 안에서 불러야 포트 선택 창이 열린다 */
export async function connectSensor(): Promise<void> {
  try {
    await activeInstance?.connect();
  } catch {
    // 실패 사유는 소스가 sourceState·sourceMessage로 남긴다
  }
}

/**
 * 재연결 시도 하나(설계 4-2, D1·D3): 제스처가 필요 없는 동작을 한 번 하고, 손·발이 모두 돌아올 때까지 최대 3초 기다린다.
 * 연결 중이면 reopen(동글: 포트 닫고 다시 열기), 끊겨 있으면 autoConnect(허락된 포트·보관 기기·재접속).
 */
async function reconnectAttempt(src: InputSource, signal: AbortSignal): Promise<void> {
  if (activeInstance !== src) throw new Error('입력 소스가 바뀌었습니다');
  if (src.state === 'connected' && src.reopen) await src.reopen();
  else if (src.autoConnect) await src.autoConnect();
  else await src.connect();
  if (signal.aborted || activeInstance !== src) throw new Error('취소됨');
  await waitForDevices(
    () => {
      const live = useLive.getState();
      // 페달은 동글 소스에서만 필요한 기기다(D3)
      return pedalRequired(live.activeSensor) ? [...live.connected, ...live.pedal.connected] : [...live.connected];
    },
    (l) => useLive.subscribe(l),
    RECONNECT_WAIT_MS,
    signal,
  );
}

/**
 * 화면이 자세 기준면(캔버스)을 등록한다. 활성 센서가 setSurface를 지원하면 넘기고 아니면 무시한다.
 * toPose는 표면 정규 좌표 → 자세 변환(원근 보기 캔버스만 넘긴다). 언마운트 시 null로 해제한다.
 */
export function bindSensorSurface(el: HTMLElement | null, toPose?: SurfaceToPose): void {
  lastSurface = el;
  lastSurfaceToPose = el ? toPose : undefined;
  activeInstance?.setSurface?.(el, lastSurfaceToPose);
}
