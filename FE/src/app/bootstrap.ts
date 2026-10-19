// 설정 ↔ 입력 소스 ↔ 라이브 스토어 ↔ 오디오를 잇는 접착 코드. main.tsx에서 한 번 부른다.
// 키보드 소스는 항상 켜 두고, 센서 소스는 설정 sensorKind가 가리키는 하나만 켠다 (설계 D9).
import type { InputSource } from '@/input/InputSource';
import { WebSocketStickSource } from '@/input/WebSocketStickSource';
import { bleSource, inputManager, keyboardSource, pointerSource, wsSource } from './sources';
import { useSettings, type SensorKind } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { audioEngine } from '@/audio/AudioEngine';
import { pushTelemetry } from '@/engine/telemetry';
import type { ResolvedHit } from '@/domain/events';

const sensorSources: Record<Exclude<SensorKind, 'none'>, InputSource> = {
  pointer: pointerSource,
  ble: bleSource,
  websocket: wsSource,
};

let currentSensor: SensorKind = 'none';
let unsubState: (() => void) | null = null;

/** "타격이 오면 소리를 낼지"를 모드 화면이 결정한다. 리듬 게임은 자체 처리 */
let soundOnHit = true;
export function setSoundOnHit(v: boolean): void {
  soundOnHit = v;
}

/** 센서 소스 교체. 키보드는 건드리지 않는다 */
export async function activateSensor(kind: SensorKind): Promise<void> {
  if (currentSensor === kind) return;
  if (currentSensor !== 'none') await inputManager.detach(currentSensor);
  unsubState?.();
  unsubState = null;
  currentSensor = kind;
  useLive.setState({ activeSensor: kind, connected: [false, false], sourceState: 'disconnected', sourceMessage: null });
  if (kind === 'none') return;
  const src = sensorSources[kind];
  if (src instanceof WebSocketStickSource) src.setUrl(useSettings.getState().wsUrl);
  unsubState = src.onState((s, message) => useLive.setState({ sourceState: s, sourceMessage: message ?? null }));
  try {
    await inputManager.attach(src);
  } catch (e) {
    useLive.setState({ sourceState: 'error', sourceMessage: (e as Error).message });
  }
}

/** 키보드 소스가 반응할 키. 센서 소스가 타격 키로 쓰는 것(포인터 F/J)은 뺀다 — 한 키에 두 번 울리지 않게 */
function keyboardKeys(): string[] {
  const s = useSettings.getState();
  const taken = s.sensorKind === 'pointer' ? new Set([s.pointerHitKeys.left, s.pointerHitKeys.right]) : new Set<string>();
  return Object.keys(s.keyMap).filter((code) => !taken.has(code));
}

export function bootstrapInput(): void {
  // 설정 변경을 소스·매퍼에 반영
  const applySettings = () => {
    const s = useSettings.getState();
    inputManager.setKeyMap(s.keyMap);
    keyboardSource.setKeys(keyboardKeys());
    pointerSource.setOptions({ leftHitKey: s.pointerHitKeys.left, rightHitKey: s.pointerHitKeys.right });
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
