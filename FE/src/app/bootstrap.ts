// 설정 ↔ 입력 소스 ↔ 라이브 스토어 ↔ 오디오를 잇는 접착 코드. main.tsx에서 한 번 부른다.
// 키보드 소스는 항상 켜 두고, 센서 소스는 설정 sensorKind가 가리키는 하나만 켠다 (설계 D9).
import type { InputSource } from '@/input/InputSource';
import { inputManager, keyboardSource } from './sources';
import { resolveOptions, sensorRegistry } from './sensorRegistry';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { audioEngine } from '@/audio/AudioEngine';
import { pushTelemetry } from '@/engine/telemetry';
import type { ResolvedHit, SensorId } from '@/domain/events';

let currentSensor: SensorId = 'none';
/** 지금 연결된 센서 인스턴스. 'none'이면 null */
let activeInstance: InputSource | null = null;
let unsubState: (() => void) | null = null;
/** 화면이 마지막으로 등록한 입력 표면. 센서가 바뀌어도 새 인스턴스에 다시 넘긴다 */
let lastSurface: HTMLElement | null = null;

/** "타격이 오면 소리를 낼지"를 모드 화면이 결정한다. 리듬 게임은 자체 처리 */
let soundOnHit = true;
export function setSoundOnHit(v: boolean): void {
  soundOnHit = v;
}

/** 활성 센서의 디스크립터에 현재 설정값(기본값 병합)을 적용한다 */
function applySensorOptions(): void {
  const desc = sensorRegistry.get(currentSensor);
  if (!desc || !activeInstance) return;
  const stored = useSettings.getState().sensorOptions[currentSensor];
  desc.applyOptions?.(activeInstance, resolveOptions(desc, stored));
}

/** 센서 소스 교체. 키보드는 건드리지 않는다 */
export async function activateSensor(id: SensorId): Promise<void> {
  if (currentSensor === id) return;
  if (activeInstance) await inputManager.detach(activeInstance.kind);
  unsubState?.();
  unsubState = null;
  activeInstance = null;
  currentSensor = id;
  useLive.setState({ activeSensor: id, connected: [false, false], sourceState: 'disconnected', sourceMessage: null });
  if (id === 'none') return;
  try {
    const src = sensorRegistry.instance(id);
    activeInstance = src;
    applySensorOptions();
    src.setSurface?.(lastSurface);
    unsubState = src.onState((s, message) => useLive.setState({ sourceState: s, sourceMessage: message ?? null }));
    await inputManager.attach(src);
  } catch (e) {
    useLive.setState({ sourceState: 'error', sourceMessage: (e as Error).message });
  }
}

/**
 * 화면이 자세 기준면(캔버스)을 등록한다. 활성 센서가 setSurface를 지원하면 넘기고 아니면 무시한다.
 * 언마운트 시 null로 해제한다.
 */
export function bindSensorSurface(el: HTMLElement | null): void {
  lastSurface = el;
  activeInstance?.setSurface?.(el);
}

/** 키보드 소스가 반응할 키. 센서 소스가 점유하는 키(디스크립터 reservedKeys)는 뺀다 — 한 키에 두 번 울리지 않게 */
function keyboardKeys(): string[] {
  const s = useSettings.getState();
  const desc = sensorRegistry.get(s.sensorKind);
  const reserved = desc?.reservedKeys?.(resolveOptions(desc, s.sensorOptions[s.sensorKind])) ?? [];
  const taken = new Set(reserved);
  return Object.keys(s.keyMap).filter((code) => !taken.has(code));
}

export function bootstrapInput(): void {
  // 저장된 sensorKind가 등록되지 않은 id(제거된 소스, 다른 PC에서 복사한 설정)면 'none'으로 되돌린다(R6)
  if (!sensorRegistry.isKnown(useSettings.getState().sensorKind)) useSettings.setState({ sensorKind: 'none' });

  // 설정 변경을 소스·매퍼에 반영
  const applySettings = () => {
    const s = useSettings.getState();
    inputManager.setKeyMap(s.keyMap);
    keyboardSource.setKeys(keyboardKeys());
    applySensorOptions();
    inputManager.setProfile(s.profile);
    audioEngine.setVolume(s.volume);
  };
  applySettings();
  useSettings.subscribe(applySettings);

  // 연결 표시는 센서 기준. 키보드는 항상 켜져 있으므로 표시하지 않는다
  inputManager.onStatus((stickId, connected, source) => {
    if (source === 'keyboard') return;
    const c = [...useLive.getState().connected] as [boolean, boolean];
    c[stickId] = connected;
    useLive.setState({ connected: c });
  });
  inputManager.onPose((stickId, pose) => {
    const p = [...useLive.getState().pose] as [typeof pose, typeof pose];
    p[stickId] = pose;
    useLive.setState({ pose: p });
  });
  inputManager.onHit((hit: ResolvedHit) => {
    if (soundOnHit && hit.pad) {
      hit.tAudio = audioEngine.trigger(hit.pad, hit.velocity);
      // PLAY-07: 브라우저 측 진동 명령. 실제 지연 없는 진동은 MCU 로컬 트리거가 맡는다
      inputManager.haptic(hit.stickId, hit.velocity * 2, 30);
    }
    useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
    if (soundOnHit) pushTelemetry(hit);
  });

  void inputManager.attach(keyboardSource);
  void activateSensor(useSettings.getState().sensorKind);
  useSettings.subscribe((s, prev) => {
    if (s.sensorKind !== prev.sensorKind) void activateSensor(s.sensorKind);
  });
}

/** 첫 사용자 제스처에서 오디오 켜기 */
export async function unlockAudio(): Promise<void> {
  await audioEngine.ensure();
  useLive.setState({ audioReady: audioEngine.ready });
}
