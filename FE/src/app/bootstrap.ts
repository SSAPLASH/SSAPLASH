// 설정 ↔ 입력 소스 ↔ 라이브 스토어 ↔ 오디오를 잇는 접착 코드. main.tsx에서 한 번 부른다.
// 키보드 소스는 항상 켜 두고, 센서 소스는 설정 sensorKind가 가리키는 하나만 켠다 (설계 D9).
import type { InputSource } from '@/input/InputSource';
import { inputManager, keyboardSource, KEYBOARD_INPUT_ENABLED } from './sources';
import { resolveOptions, sensorRegistry } from './sensorRegistry';
import { useSettings } from '@/store/settingsStore';
import { useLive, type MetronomeLive } from '@/store/liveStore';
import { audioEngine } from '@/audio/AudioEngine';
import { loadSampleSet, type SoundSet, type SoundSetId } from '@/audio/soundSets';
import { pushTelemetry } from '@/engine/telemetry';
import type { ResolvedHit, SensorId } from '@/domain/events';
import type { PadId } from '@/domain/pads';
import { applyRadiusTuning } from '@/domain/tuning';
import { metronome } from '@/engine/Metronome';

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
    // 튜닝은 다음 타격부터 반영된다. 프로필의 반경은 앵커 중심 + 현재 튜닝으로 매번 다시 계산한다(T1)
    inputManager.setProfile(applyRadiusTuning(s.profile, s.tuning));
    inputManager.setVelocityCurve(s.tuning.velocity);
    inputManager.setSensorOffsetMs(s.tuning.sensorOffsetMs);
    inputManager.setOutsidePolicy(s.tuning.outsidePolicy);
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

  if (KEYBOARD_INPUT_ENABLED) void inputManager.attach(keyboardSource);
  void activateSensor(useSettings.getState().sensorKind);
  useSettings.subscribe((s, prev) => {
    if (s.sensorKind !== prev.sensorKind) void activateSensor(s.sensorKind);
    if (s.soundSetId !== prev.soundSetId) void applySoundSet();
  });
}

/**
 * 전역 메트로놈 접착. main.tsx에서 bootstrapInput() 다음에 한 번 부른다.
 * 엔진이 BPM·박자의 주인이고, 여기서 liveStore(화면용)·settingsStore(영속)로 옮긴다.
 */
export function bootstrapMetronome(): void {
  const s0 = useSettings.getState();
  // 초기값: settings → 엔진
  metronome.setBpm(s0.metronomeBpm);
  metronome.setBeatsPerBar(s0.metronomeBeatsPerBar);
  metronome.bind({
    click: (atMs, accent) => audioEngine.click(atMs, accent),
    ensureAudio: unlockAudio,
    onAudioState: (listener) => {
      audioEngine.onStateChange(listener);
    },
  });

  const setLive = (patch: Partial<MetronomeLive>) =>
    useLive.setState((s) => ({ metronome: { ...s.metronome, ...patch } }));

  // 박 표시는 소리 시각에 맞춰 늦춰 쓴다. 정지되면 대기 중인 표시를 지운다
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const clearPending = () => {
    for (const id of pending) clearTimeout(id);
    pending.clear();
  };

  metronome.onBeat((info) => {
    // 햅틱 박자 안내 자리: 여기서 inputManager.haptic(...)을 info.atMs 기준으로 보낼 수 있다(이번엔 호출하지 않음)
    const id = setTimeout(() => {
      pending.delete(id);
      useLive.setState((s) => ({ metronome: { ...s.metronome, beat: info.beatInBar, beatSeq: s.metronome.beatSeq + 1 } }));
    }, Math.max(0, info.atMs - performance.now()));
    pending.add(id);
  });

  metronome.onChange((st) => {
    if (!st.playing) {
      clearPending();
      setLive({ ...st, beat: -1 });
    } else {
      setLive(st);
    }
    const cur = useSettings.getState();
    if (cur.metronomeBpm !== st.bpm) cur.setMetronomeBpm(st.bpm);
    if (cur.metronomeBeatsPerBar !== st.beatsPerBar) cur.setMetronomeBeatsPerBar(st.beatsPerBar);
  });

  // 탭이 다시 보이거나 오디오가 복구되면 현재 박으로 맞춘다
  metronome.onResync((beat) => {
    clearPending();
    setLive({ beat });
  });

  // 초기 BPM·박자를 화면용 사본에도 반영(위 setBpm은 구독 전에 불렸다)
  setLive(metronome.state);

  // 패드 소리 음소거(메트로놈 클릭은 남는다)
  audioEngine.setPadMuted(!s0.soundOn);
  useSettings.subscribe((s, prev) => {
    if (s.soundOn !== prev.soundOn) audioEngine.setPadMuted(!s.soundOn);
  });

  if (import.meta.env.DEV) (window as unknown as { __metronome?: typeof metronome }).__metronome = metronome;
}

// ── 사운드 세트 ──────────────────────────────────────────────
/** 디코드가 끝난 세트 캐시. 세트를 다시 고를 때 재다운로드하지 않는다 */
const soundSetCache = new Map<SoundSetId, SoundSet>();
let appliedSetId: SoundSetId | null = null;
let loadingSetId: SoundSetId | null = null;
/** 세트를 빠르게 바꿔 응답이 뒤섞여도 마지막 선택만 반영하기 위한 번호 */
let soundSetRequest = 0;

function commitSoundSet(set: SoundSet | null, id: SoundSetId): void {
  audioEngine.setSoundSet(set);
  appliedSetId = id;
  useLive.setState({ soundSetState: 'ready', soundSetMissing: set?.missing ?? [] });
}

/**
 * 설정의 soundSetId에 맞춰 세트를 적용한다. 오디오가 아직 켜지지 않았으면(디코드할 컨텍스트가 없으면)
 * 아무것도 하지 않고, unlockAudio가 다시 부른다. 로딩 중 타격은 합성음으로 울린다.
 */
async function applySoundSet(): Promise<void> {
  const id = useSettings.getState().soundSetId;
  if (id === 'synth') {
    soundSetRequest++;
    loadingSetId = null;
    commitSoundSet(null, id);
    return;
  }
  const cached = soundSetCache.get(id);
  if (cached) {
    soundSetRequest++;
    loadingSetId = null;
    commitSoundSet(cached, id);
    return;
  }
  const ctx = audioEngine.context;
  if (!ctx || loadingSetId === id) return;
  const req = ++soundSetRequest;
  loadingSetId = id;
  appliedSetId = null;
  audioEngine.setSoundSet(null);
  useLive.setState({ soundSetState: 'loading', soundSetMissing: [] });
  try {
    const set = await loadSampleSet(ctx, id);
    soundSetCache.set(id, set);
    if (req !== soundSetRequest) return;
    loadingSetId = null;
    commitSoundSet(set, id);
  } catch {
    if (req !== soundSetRequest) return;
    loadingSetId = null;
    useLive.setState({ soundSetState: 'error', soundSetMissing: [] });
  }
}

let previewSeq = 0;
/**
 * 세팅 화면의 "톡 치기". 소리와 화면 표시(lastHit·hitSeq)만 내고 텔레메트리·통계에는 넣지 않는다(source 'preview').
 */
export async function previewHit(pad: PadId, velocity: number): Promise<void> {
  await unlockAudio();
  const now = performance.now();
  const hit: ResolvedHit = {
    id: --previewSeq,
    stickId: 0,
    pad,
    velocity,
    tHit: now,
    tRecv: now,
    tResolved: now,
    source: 'preview',
    pose: { pitch: 0, yaw: 0 },
    peakAccel: 0,
  };
  hit.tAudio = audioEngine.trigger(pad, velocity);
  useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
}

/** 첫 사용자 제스처에서 오디오 켜기 */
export async function unlockAudio(): Promise<void> {
  await audioEngine.ensure();
  useLive.setState({ audioReady: audioEngine.ready });
  // 첫 제스처 이후 세트 로드(이미 적용·로딩 중이면 건너뜀)
  if (appliedSetId !== useSettings.getState().soundSetId) void applySoundSet();
}
