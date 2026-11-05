// 설정 ↔ 입력 소스 ↔ 라이브 스토어 ↔ 오디오를 잇는 접착 코드. main.tsx에서 한 번 부른다.
// 키보드 소스는 항상 켜 두고, 센서 소스는 설정 sensorKind가 가리키는 하나만 켠다 (설계 D9).
import type { InputSource } from '@/input/InputSource';
import { inputManager, keyboardSource, touchSource, KEYBOARD_INPUT_ENABLED } from './sources';
import { KEY_MAP } from '@/domain/keyMap';
import { resolveOptions, sensorRegistry } from './sensorRegistry';
import { onStickLinked } from './hapticMode';
import { useSettings } from '@/store/settingsStore';
import { initialPedal, useLive, type MetronomeLive } from '@/store/liveStore';
import { setReconnectHandler, useReconnect } from '@/store/reconnectStore';
import { RECONNECT_WAIT_MS, hintFor, shouldResend, waitForDevices } from './reconnectPolicy';
import { audioEngine } from '@/audio/AudioEngine';
import { loadSampleSet, type SoundSet, type SoundSetId } from '@/audio/soundSets';
import { pushTelemetry } from '@/engine/telemetry';
import { diagTap } from '@/engine/diagTap';
import type { ResolvedHit, SensorId } from '@/domain/events';
import type { PadId } from '@/domain/pads';
import { layoutToProfile } from '@/domain/kitJudge';
import { metronome } from '@/engine/Metronome';
import { padTableSync } from '@/input/padTableSync';
import { yawDriftMonitor } from '@/input/yawDriftMonitor';
import { smoothBattery } from '@/domain/stickStatus';
import { devicesReady, pedalRequired } from '@/domain/pedalStatus';
import type { CalibrationProfile, YawDriftStatus } from '@/domain/calibration';
import { isSensorSource } from '@/domain/events';

let currentSensor: SensorId = 'none';
/** 지금 연결된 센서 인스턴스. 'none'이면 null */
let activeInstance: InputSource | null = null;
let unsubState: (() => void) | null = null;
let unsubDongle: (() => void) | null = null;
/** 손별 최근 배터리 측정값(평균용). 그 손이 끊기거나 센서가 바뀌면 비운다 */
let batteryHistory: [number[], number[]] = [[], []];
/** 발별 최근 배터리 측정값(평균용). 두 발이 모두 끊기거나 센서가 바뀌면 비운다 */
let pedalBatteryHistory: [number[], number[]] = [[], []];
/** 화면이 마지막으로 등록한 입력 표면. 센서가 바뀌어도 새 인스턴스에 다시 넘긴다 */
let lastSurface: HTMLElement | null = null;
/** 손별 마지막 설정 재전송 시각(비트 5 쿨다운, D5). 센서가 바뀌면 비운다 */
const lastResendAt: [number | null, number | null] = [null, null];

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
  desc.applyTuning?.(activeInstance, useSettings.getState().tuning);
}

/** 현재 설정에서 유도한 판정 프로필(설계 D1) */
function currentProfile(): CalibrationProfile {
  const s = useSettings.getState();
  return layoutToProfile(s.kitLayout, s.tuning.angleRange, {
    maxRadiusDeg: s.tuning.maxRadiusDeg,
    radiusFactor: s.tuning.radiusFactor,
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
    src.setSurface?.(lastSurface);
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
  return Object.keys(KEY_MAP).filter((code) => !taken.has(code));
}

/** 모니터 따라보기 창으로 열렸는지. 저장된 센서를 자동 연결하지 않는 기준 */
function isFollowWindow(): boolean {
  return location.pathname.startsWith('/monitor') && new URLSearchParams(location.search).get('follow') === '1';
}

/** 모니터 중계(VITE_MONITOR 빌드 한정)를 시작한다. 삼항·상수 분기로 감싸 미설정 빌드에서는 청크가 만들어지지 않는다 */
const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';
function startRelay(): void {
  if (!MONITOR_ENABLED) return;
  void import('./monitorRelay').then((m) =>
    m.startMonitorRelay({
      // relay가 bootstrap의 센서 상태를 직접 알지 않도록 getter를 넘긴다
      getInfo: () => ({
        source: activeInstance?.label ?? '키보드',
        profileId: null,
        offsets: [activeInstance?.clockOffsetOf?.(0) ?? null, activeInstance?.clockOffsetOf?.(1) ?? null],
        transport: activeInstance?.transportStats?.() ?? null,
        audio: (() => {
          const lat = audioEngine.latency();
          return lat ? { baseMs: lat.baseLatencyMs, outputMs: lat.outputLatencyMs } : null;
        })(),
      }),
    }),
  );
}

/**
 * 텔레메트리 전송(VITE_MONITOR 빌드 한정, 설계 MONITOR-001). 이 창이 이벤트 원천이다 —
 * 따라보기 모니터 창은 센서를 열지 않고 resolved를 만들지 않으므로 수집해도 0건이다.
 */
function startTelemetry(): void {
  if (!MONITOR_ENABLED) return;
  void import('@/telemetry/enable').then((m) =>
    m.initTelemetry({
      subscribeConnection: (l) => inputManager.onStatus(l),
      getActiveSource: () => (useLive.getState().activeSensor === 'none' ? null : useLive.getState().activeSensor),
      subscribeActiveSource: (l) => useLive.subscribe((s, prev) => s.activeSensor !== prev.activeSensor && l()),
    }),
  );
}

export function bootstrapInput(): void {
  // 키보드 매핑은 고정 상수라 설정 구독 밖에서 한 번만 넘긴다
  inputManager.setKeyMap(KEY_MAP);
  // 패드 표 적용 상태를 liveStore로 옮긴다(input → store 직접 import 금지라 콜백 주입)
  padTableSync.onStatus((st) => useLive.setState({ padTable: st }));
  // 방위각 드리프트 보정 상태도 같은 방식으로 스틱별로 옮긴다
  yawDriftMonitor.onStatus((stickId, st) =>
    useLive.setState((s) => {
      const arr: [YawDriftStatus | null, YawDriftStatus | null] = [s.yawDrift[0], s.yawDrift[1]];
      arr[stickId] = st;
      return { yawDrift: arr };
    }),
  );
  // 기준 자세를 다시 잡으면 펌웨어가 방위각 오프셋을 0으로 되돌리므로 FE 기억도 비운다
  inputManager.onResetPose(() => yawDriftMonitor.reset());

  // 저장된 sensorKind가 등록되지 않은 id(제거된 소스, 다른 PC에서 복사한 설정)면 'none'으로 되돌린다(R6)
  if (!sensorRegistry.isKnown(useSettings.getState().sensorKind)) useSettings.setState({ sensorKind: 'none' });

  // 설정 변경을 소스·매퍼에 반영
  const applySettings = () => {
    const s = useSettings.getState();
    keyboardSource.setKeys(keyboardKeys());
    applySensorOptions();
    // 튜닝은 다음 타격부터 반영된다. 판정 프로필은 배치에서 유도(설계 D1): 배치·각도 범위·반경 튜닝이 바뀔 때마다 다시 만든다.
    const profile = currentProfile();
    inputManager.setProfile(profile);
    padTableSync.push(profile);
    inputManager.setVelocityCurve(s.tuning.velocity);
    inputManager.setSensorOffsetMs(s.tuning.sensorOffsetMs);
    inputManager.setOutsidePolicy(s.tuning.outsidePolicy);
    audioEngine.setVolume(s.volume);
    audioEngine.setDrumVolume(s.drumVolume);
    audioEngine.setSongVolume(s.songVolume);
    audioEngine.setClickVolume(s.metronomeVolume);
  };
  applySettings();
  useSettings.subscribe(applySettings);

  // 연결 표시는 센서 기준. 키보드는 항상 켜져 있으므로 표시하지 않는다.
  // 손별 연결은 소스가 알린다(동글은 LINK 마스크, 그 외는 STATUS·포트 닫힘). STATUS는 5초마다 와서 같은 연결이 반복된다.
  // 끊김 → 자동 재연결 시작, 양손 복귀 → settle, 비트 5(설정 전) → 설정 재전송(설계 PLAY-002 4-1).
  inputManager.onStatus((stickId, connected, source, batteryPct, unconfigured) => {
    if (!isSensorSource(source)) return;
    const live = useLive.getState();
    const wasConnected = live.connected[stickId];
    const c = [...live.connected] as [boolean, boolean];
    c[stickId] = connected;
    const b = [...live.battery] as [number | null, number | null];
    if (!connected) {
      // 끊긴 손은 배터리를 지운다(다시 붙으면 새로 잰다)
      batteryHistory[stickId] = [];
      b[stickId] = null;
    } else if (batteryPct !== undefined) {
      const sm = smoothBattery(batteryHistory[stickId], batteryPct);
      batteryHistory[stickId] = sm.history;
      b[stickId] = sm.value;
    }
    useLive.setState({ connected: c, battery: b });
    if (!connected && wasConnected && useLive.getState().activeSensor !== 'none') {
      // 손이 끊겼다 → 자동 재연결 시작(시도 중이면 스토어가 무시한다. reopen이 내는 끊김으로 루프가 다시 시작되지 않는다)
      useReconnect.getState().start();
    }
    // 손 둘 + 발 둘이 모두 붙어야 복귀(PLAY-002 D3)
    {
      const after = useLive.getState();
      if (devicesReady(after.activeSensor, c, after.pedal)) useReconnect.getState().settle();
    }
    if (connected) {
      if (unconfigured === true) {
        // 비트 5(설정 전): 그 손에만 패드 표를 강제로 보내고 방위각 오프셋을 0으로 맞춘다. 1초 쿨다운(D5)
        const now = performance.now();
        if (shouldResend(lastResendAt[stickId], now)) {
          lastResendAt[stickId] = now;
          padTableSync.push(currentProfile(), { stickId, force: true });
          yawDriftMonitor.onConnected(stickId);
        }
        // 부팅 직후라 로컬 진동 설정도 초기값이다 → 현재 모드 값을 그 손에 보낸다(PLAY-006)
        onStickLinked(stickId);
      } else if (!wasConnected) {
        // 새로 붙은 손에만(ROUTE) 현재 표를 보낸다 — 프로토콜 5장 "연결할 때마다 설정 재전송". 포트를 닫았다 연 뒤 첫 전송만 나가고
        // 그 손에 같은 표를 이미 보냈으면 무동작(해시는 손별). 다른 손에는 가지 않는다.
        // 방위각 0은 비트 5 정보가 없는 소스(BLE 직결 등)에만 — 비트 5 = 0인 재연결은 스틱의 보정을 지우지 않는다(설계 1-4 ③)
        padTableSync.push(currentProfile(), { stickId });
        if (unconfigured === undefined) yawDriftMonitor.onConnected(stickId);
        // 새로 붙은 손에 현재 진동 모드 값을 보낸다(곡 연주 중이면 0, 아니면 1)
        onStickLinked(stickId);
      }
    }
    // 기준 자세를 잡은 뒤 연결이 끊기면 재연결 때 다시 맞추라고 안내한다(강제하지 않음)
    if (!connected && wasConnected && live.referenceSetAt !== null) useLive.setState({ referenceStale: true });
  });
  // 페달 연결·배터리(PLAY-002 4-1). 소스가 내려가거나 포트가 닫히면 InputManager가 두 발 끊김을 알린다
  inputManager.onPedalStatus((foot, connected, batteryPct) => {
    const live = useLive.getState();
    const i = foot - 2;
    const wasConnected = live.pedal.connected[i];
    const c = [...live.pedal.connected] as [boolean, boolean];
    c[i] = connected;
    let battery = live.pedal.battery;
    if (!connected) {
      pedalBatteryHistory[i] = [];
      if (!c[0] && !c[1]) battery = null;
    } else if (batteryPct !== undefined) {
      const sm = smoothBattery(pedalBatteryHistory[i], batteryPct);
      pedalBatteryHistory[i] = sm.history;
      battery = sm.value;
    }
    // 왼발(하이햇)이 끊기면 닫힘으로 되돌린다(D5)
    const hihatClosed = foot === 2 && !connected ? true : live.pedal.hihatClosed;
    useLive.setState({ pedal: { connected: c, battery, hihatClosed } });
    audioEngine.setHihatOpen(c[0] && !hihatClosed);
    if (!connected && wasConnected && useLive.getState().activeSensor !== 'none') {
      // 발이 끊겼다 → 손과 같이 자동 재연결 시작
      useReconnect.getState().start();
    }
    const after = useLive.getState();
    if (devicesReady(after.activeSensor, after.connected, after.pedal)) useReconnect.getState().settle();
  });
  inputManager.onPedal((closed) => {
    const live = useLive.getState();
    useLive.setState({ pedal: { ...live.pedal, hihatClosed: closed } });
    audioEngine.setHihatOpen(live.pedal.connected[0] && !closed);
  });
  inputManager.onPose((stickId, pose) => {
    const p = [...useLive.getState().pose] as [typeof pose, typeof pose];
    p[stickId] = pose;
    useLive.setState({ pose: p });
  });
  inputManager.onHit((hit: ResolvedHit) => {
    if (soundOnHit && hit.pad) {
      // 소리를 예약하지 못했으면(오디오 미해제 등) tAudio를 비워 둔다
      const tAudio = audioEngine.trigger(hit.pad, hit.velocity);
      if (tAudio !== null) hit.tAudio = tAudio;
      // 타격 진동은 스틱이 패드를 판정한 순간 직접 울린다(PLAY-006). 브라우저 명령은 늦게 도착해 진동이 겹치므로 보내지 않는다
    }
    useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
    if (soundOnHit) pushTelemetry(hit);
    // 모니터 진단: 구독자가 없으면 즉시 반환한다. 연주 화면은 tAudio를 이 뒤에 채우므로 hit 참조를 싣는다
    diagTap.publish({ type: 'resolved', hit });
    // 센서 타격의 방위각 오차를 모아 드리프트를 보정한다(소리·텔레메트리 뒤라 지연에 영향 없음)
    if (isSensorSource(hit.source)) yawDriftMonitor.observe(hit, currentProfile());
  });

  if (KEYBOARD_INPUT_ENABLED) void inputManager.attach(keyboardSource);
  // 화면 터치는 키보드 사용 여부와 무관하게 항상 붙인다(터치 연주를 켜는 화면만 strike를 부른다)
  void inputManager.attach(touchSource);
  // 모니터 따라보기 창(/monitor/stick?follow=1)은 센서를 열지 않는다 — 연결은 연주 창이 가진다
  if (!isFollowWindow()) void activateSensor(useSettings.getState().sensorKind, true);
  useSettings.subscribe((s, prev) => {
    if (s.sensorKind !== prev.sensorKind) void activateSensor(s.sensorKind);
    if (s.soundSetId !== prev.soundSetId) void applySoundSet();
  });
  startRelay();
  startTelemetry();
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
    // 잠금 중 값은 곡 값이므로 사용자 설정에 저장하지 않는다
    if (st.locked) return;
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
    judgedBy: 'pose',
  };
  const tAudio = audioEngine.trigger(pad, velocity);
  if (tAudio !== null) hit.tAudio = tAudio;
  useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
}

/** 첫 사용자 제스처에서 오디오 켜기 */
export async function unlockAudio(): Promise<void> {
  await audioEngine.ensure();
  useLive.setState({ audioReady: audioEngine.ready });
  // 첫 제스처 이후 세트 로드(이미 적용·로딩 중이면 건너뜀)
  if (appliedSetId !== useSettings.getState().soundSetId) void applySoundSet();
}
