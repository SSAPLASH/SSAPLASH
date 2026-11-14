// 설정 ↔ 입력 소스 ↔ 라이브 스토어 ↔ 오디오를 잇는 접착 코드. main.tsx에서 한 번 부른다.
// 키보드 소스는 항상 켜 두고, 센서 소스는 설정 sensorKind가 가리키는 하나만 켠다 (설계 D9).
import { inputManager, keyboardSource, touchSource, KEYBOARD_INPUT_ENABLED } from '@/runtime/sources';
import { KEY_MAP } from '@/domain/kit/keyMap';
import { resolveOptions, sensorRegistry } from '@/runtime/sensorRegistry';
import { onStickLinked } from '@/features/play/hapticMode';
import { useSettings } from '@/store/settingsStore';
import { useLive, type MetronomeLive } from '@/store/liveStore';
import { resolveSubdivision } from '@/domain/time/metronome';
import { useReconnect } from '@/store/reconnectStore';
import { shouldResend } from '@/runtime/reconnectPolicy';
import { audioEngine } from '@/audio/AudioEngine';
import { applySoundSet, unlockAudio } from '@/runtime/audioUnlock';
import { pushTelemetry } from '@/engine/telemetry';
import { diagTap } from '@/engine/diagTap';
import { addPlayStartHook } from '@/engine/diagReport';
import { preloadSprites } from '@/components/drum/acoustic/sprites';
import { startClockDiag } from './diag/clockDiag';
import type { ResolvedHit, StickId } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { calibrationSession } from '@/runtime/calibrationSession';
import { timingCalSession } from '@/runtime/timingCalSession';
import { metronomePreview } from '@/runtime/metronomePreview';
import { startAudioDiag } from './diag/audioDiag';
import { metronome } from '@/engine/Metronome';
import { padTableSync } from '@/input/padTableSync';
import { yawDriftMonitor } from '@/input/yawDriftMonitor';
import { arrivalSkewWatch } from '@/runtime/arrivalSkewWatch';
import { smoothBattery } from '@/domain/kit/device/stickStatus';
import { kickOffsetOrStick } from '@/domain/kit/calibration/timingCalibration';
import { devicesReady } from '@/domain/kit/device/pedalStatus';
import type { PadTableStatus, YawDriftStatus } from '@/domain/kit/calibration/calibration';
import { isSensorSource } from '@/domain/events';
import { hitSoundActive, setCalibrationSound } from '@/runtime/hitSound';
import {
  activateSensor,
  activeInstance,
  applySensorOptions,
  batteryHistory,
  currentProfiles,
  lastResendAt,
  noteMinPeakCapture,
  pedalBatteryHistory,
  pushMinPeak,
  pushTable,
} from '@/runtime/sensorSession';

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
  // 손별 패드 표 적용 상태를 liveStore로 옮긴다(input → store 직접 import 금지라 콜백 주입)
  padTableSync.onStatus((stickId, st) =>
    useLive.setState((s) => {
      const arr: [PadTableStatus | null, PadTableStatus | null] = [s.padTable[0], s.padTable[1]];
      arr[stickId] = st;
      return { padTable: arr };
    }),
  );
  calibrationSession.bind({
    setSoundOnHit: setCalibrationSound,
    pushTable: (stickId, force) => pushTable(stickId, force),
    noteMinPeakCapture,
  });
  // 방위각 드리프트 보정 상태도 같은 방식으로 스틱별로 옮긴다
  yawDriftMonitor.onStatus((stickId, st) =>
    useLive.setState((s) => {
      const arr: [YawDriftStatus | null, YawDriftStatus | null] = [s.yawDrift[0], s.yawDrift[1]];
      arr[stickId] = st;
      return { yawDrift: arr };
    }),
  );
  // 보정 전송을 진단 줄로 남긴다(구독자가 없으면 publish가 즉시 반환)
  yawDriftMonitor.onCorrection((c) => diagTap.publish({ type: 'yawCorrect', ...c }));
  // 부호가 연달아 뒤집혀 손이 멈추면 진단 줄을 남기고, 그 손을 재정렬 필요로 올린다(다음 곡 시작 확인 창·자유 연습 띠가 이어받는다)
  yawDriftMonitor.onHalt((h) => {
    diagTap.publish({ type: 'yawHalt', ...h });
    if (useSettings.getState().stickAnchors[h.stickId] && calibrationSession.currentMode !== 'capture') {
      useLive.setState((s) => {
        const r: [boolean, boolean] = [s.realignNeeded[0], s.realignNeeded[1]];
        r[h.stickId] = true;
        return { realignNeeded: r };
      });
    }
  });
  // 곡을 시작할 때마다(재시작 포함, 진단 구독과 무관) 멈춤을 푼다. 재정렬 안내를 건너뛰어도 다음 판에는 다시 시도한다
  addPlayStartHook(() => yawDriftMonitor.beginRun());
  // 기준 자세를 다시 잡으면 펌웨어가 방위각 오프셋을 0으로 되돌리므로 FE 기억도 비운다.
  // 스틱 버튼 보정(0x22)은 세션이 처리한다: 보정 중이면 처음부터, 아니면 그 손 재정렬 필요
  inputManager.onResetPose((source, stickId) => {
    yawDriftMonitor.reset(stickId ?? undefined);
    calibrationSession.onResetPose(source, stickId);
  });

  // 저장된 sensorKind가 등록되지 않은 id(제거된 소스, 다른 PC에서 복사한 설정)면 'none'으로 되돌린다(R6)
  if (!sensorRegistry.isKnown(useSettings.getState().sensorKind)) useSettings.setState({ sensorKind: 'none' });

  // 설정 변경을 소스·매퍼에 반영
  const applySettings = () => {
    const s = useSettings.getState();
    keyboardSource.setKeys(keyboardKeys());
    applySensorOptions();
    // 튜닝은 다음 타격부터 반영된다. 판정 프로필은 손별 앵커에서 유도(PLAY-004 D1): 앵커·반경 튜닝이 바뀔 때마다 다시 만들고
    // 연결된 손마다 보낸다(같은 표면 padTableSync가 생략한다)
    inputManager.setProfiles(currentProfiles());
    const live = useLive.getState();
    // 최소 타격 세기도 손별로 보낸다(같은 값이면 생략, 보정 저장·지우기로 바뀌면 이유가 진단 줄에 남는다)
    for (const i of [0, 1] as StickId[]) {
      if (!live.connected[i]) continue;
      pushTable(i);
      pushMinPeak(i);
    }
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
        // 비트 5(설정 전): 그 손에만 패드 표를 강제로 보내고 방위각 오프셋을 0으로 맞춘다. 1초 쿨다운(D5).
        // 스틱이 다시 켜져 방위각 기준이 사라졌으므로, 그 손에 앵커가 있으면 스네어 재정렬이 필요하다(PLAY-004 4-2)
        const now = performance.now();
        if (shouldResend(lastResendAt[stickId], now)) {
          lastResendAt[stickId] = now;
          pushTable(stickId, true);
          pushMinPeak(stickId, { force: true, reason: 'linked' });
          yawDriftMonitor.onConnected(stickId);
          // 스틱이 다시 켜져 시계가 새로 시작됐다 — 그 손의 도착 지연 표본을 비운다
          arrivalSkewWatch.resetDevice(stickId === 0 ? 'left' : 'right');
          if (useSettings.getState().stickAnchors[stickId] && calibrationSession.currentMode !== 'capture') {
            useLive.setState((s) => {
              const r: [boolean, boolean] = [s.realignNeeded[0], s.realignNeeded[1]];
              r[stickId] = true;
              return { realignNeeded: r };
            });
          }
        }
        // 부팅 직후라 로컬 진동 설정도 초기값이다 → 현재 모드 값을 그 손에 보낸다(PLAY-006)
        onStickLinked(stickId);
      } else if (!wasConnected) {
        // 새로 붙은 손에만(ROUTE) 현재 표를 보낸다 — 프로토콜 5장 "연결할 때마다 설정 재전송". 포트를 닫았다 연 뒤 첫 전송만 나가고
        // 그 손에 같은 표를 이미 보냈으면 무동작(해시는 손별). 다른 손에는 가지 않는다.
        // 방위각 0은 비트 5 정보가 없는 소스(BLE 직결 등)에만 — 비트 5 = 0인 재연결은 스틱의 보정을 지우지 않는다(설계 1-4 ③).
        // 그 대신 스틱이 가진 현재 오프셋을 물어 FE 기억을 맞춘다(새로 고침 뒤에는 FE 기억이 0이다. 스틱 FW 1.12부터 답한다)
        pushTable(stickId);
        pushMinPeak(stickId, { force: true, reason: 'linked' });
        arrivalSkewWatch.resetDevice(stickId === 0 ? 'left' : 'right');
        if (unconfigured === undefined) yawDriftMonitor.onConnected(stickId);
        else yawDriftMonitor.onLinked(stickId);
        // 새로 붙은 손에 현재 진동 모드 값을 보낸다(곡 연주 중이면 0, 아니면 1)
        onStickLinked(stickId);
      }
      if (!wasConnected) calibrationSession.onHandConnected(stickId);
    } else if (wasConnected) {
      calibrationSession.onHandDisconnected(stickId);
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
    if (connected && !wasConnected) arrivalSkewWatch.resetDevice('pedal');
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
    // 기기 사이 도착 지연 표본. 보정·박자 맞추기가 가로채는 타격도 시각은 유효하므로 가로채기 앞에서 모은다(센서 타격만 받는다)
    arrivalSkewWatch.observe(hit);
    // 보정·재정렬 중인 손의 타격은 세션이 가로챈다(소리는 목표 패드로, 판정·텔레메트리 없음)
    if (calibrationSession.intercept(hit)) return;
    // 박자 맞추기 중인 타격은 소리만 내고 시각을 모은다(판정·텔레메트리·진단 없음)
    if (timingCalSession.intercept(hit)) return;
    if (hitSoundActive() && hit.pad) {
      // 소리를 예약하지 못했으면(오디오 미해제 등) tAudio를 비워 둔다
      const tAudio = audioEngine.trigger(hit.pad, hit.velocity);
      if (tAudio !== null) hit.tAudio = tAudio;
      // 타격 진동은 스틱이 패드를 판정한 순간 직접 울린다(PLAY-006). 브라우저 명령은 늦게 도착해 진동이 겹치므로 보내지 않는다
    }
    useLive.setState((s) => ({ lastHit: hit, hitSeq: s.hitSeq + 1 }));
    if (hitSoundActive()) pushTelemetry(hit);
    // 모니터 진단: 구독자가 없으면 즉시 반환한다. 연주 화면은 tAudio를 이 뒤에 채우므로 hit 참조를 싣는다
    diagTap.publish({ type: 'resolved', hit });
    // 센서 타격의 방위각 오차를 모아 드리프트를 보정한다(소리·텔레메트리 뒤라 지연에 영향 없음)
    if (isSensorSource(hit.source) && hit.stickId !== null) yawDriftMonitor.observe(hit, inputManager.profileFor(hit.stickId));
  });

  // 기기 사이 시각 차이 경고(PLAY-006): 감시 상태를 store로 옮기고 시작·끝에 진단 줄을 남긴다. 센서 소스가 바뀌거나 내려가면 표본을 비운다
  arrivalSkewWatch.onChange((skew, phase) => {
    useLive.setState({ clockSkew: phase === 'end' ? null : skew });
    if (skew && phase !== 'update') {
      diagTap.publish({ type: 'arrivalSkew', phase, spreadMs: skew.spreadMs, medians: skew.medians, outlier: skew.outlier });
    }
  });
  useLive.subscribe((s, prev) => {
    if (s.activeSensor !== prev.activeSensor) arrivalSkewWatch.reset();
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
  // 센서 시계 오프셋 진단 줄: 10초마다 + 곡 시작 직후 1회
  startClockDiag(() => activeInstance);
  // 판정 타이밍 보정·오디오 지연 진단 줄: 10초마다 + 곡 시작 직후 1회
  startAudioDiag(() => ({
    audioOffsetMs: useSettings.getState().audioOffsetMs,
    kickOffsetMs: kickOffsetOrStick(useSettings.getState().audioOffsetMs, useSettings.getState().kickOffsetMs),
    latency: audioEngine.latency(),
    timingCal: useSettings.getState().timingCal,
  }));
  startRelay();
  startTelemetry();
  preloadKitSpritesWhenIdle();
}

/**
 * 실물 드럼 스킨이면 조각 이미지를 한가할 때 미리 받는다(설계 DESIGN-acoustic-kit-image 4-6).
 * 시작을 막지 않도록 requestIdleCallback(없으면 1.5초 뒤)으로 미룬다.
 */
function preloadKitSpritesWhenIdle(): void {
  if (useSettings.getState().kitSkin !== 'acoustic') return;
  const run = () => void preloadSprites();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 1500);
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
  // 박 분할: 고른 값(자동·4분·8분)을 엔진의 BPM으로 풀어 넣는다. 설정이나 BPM이 바뀔 때마다 다시 푼다(자동이 경계 90을 넘나들 수 있다)
  const applySubdivision = () =>
    metronome.setSubdivision(resolveSubdivision(useSettings.getState().metronomeSubdivision, metronome.state.bpm));
  applySubdivision();
  // 박자 맞추기: 클릭·타격음은 게임과 같은 오디오 경로를 쓴다
  timingCalSession.bind({
    // 박자 맞추기는 강·약 두 단계만 쓴다(박 분할과 무관)
    click: (atMs, accent) => audioEngine.click(atMs, accent ? 'accent' : 'beat'),
    ensureAudio: unlockAudio,
    playHit: (hit) => {
      if (hit.pad) audioEngine.trigger(hit.pad, hit.velocity);
    },
    stopMetronome: () => metronome.stop(),
    busy: () => useLive.getState().calibration.mode !== 'idle',
    outputLatencyMs: () => audioEngine.latency()?.outputLatencyMs ?? null,
    renderAheadMs: () => audioEngine.renderAheadMs(),
    // pedal.connected는 [하이햇 페달(foot 2), 킥(foot 3)] 순서(인덱스 = foot - 2)
    kickConnected: () => useLive.getState().pedal.connected[1],
  });
  metronome.bind({
    click: (atMs, level) => audioEngine.click(atMs, level),
    renderAheadMs: () => audioEngine.renderAheadMs(),
    ensureAudio: unlockAudio,
    onAudioState: (listener) => {
      audioEngine.onStateChange(listener);
    },
  });

  // 박 분할 예시 소리: 메트로놈과 같은 클릭 경로. 메트로놈이 울리는 중이거나 곡에 잠겨 있으면 내지 않는다
  metronomePreview.bind({
    click: (atMs, level) => audioEngine.click(atMs, level),
    ensureAudio: unlockAudio,
    renderAheadMs: () => audioEngine.renderAheadMs(),
    busy: () => {
      const m = useLive.getState().metronome;
      return m.playing || m.locked;
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
    // 화면용 사본에는 박 분할을 싣지 않는다(화면은 설정 값과 BPM으로 직접 푼다)
    const live = { playing: st.playing, bpm: st.bpm, beatsPerBar: st.beatsPerBar, locked: st.locked };
    if (!st.playing) {
      clearPending();
      setLive({ ...live, beat: -1 });
    } else {
      setLive(live);
    }
    // BPM이 바뀌었으면 자동 분할을 다시 푼다. 값이 같으면 엔진이 무시하므로 되돌아오지 않는다
    applySubdivision();
    // 메트로놈이 울리기 시작하거나 곡에 잠기면 예시 소리를 끊는다
    if (st.playing || st.locked) metronomePreview.stop();
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
  const st0 = metronome.state;
  setLive({ playing: st0.playing, bpm: st0.bpm, beatsPerBar: st0.beatsPerBar, locked: st0.locked });

  // 패드 소리 음소거(메트로놈 클릭은 남는다)
  audioEngine.setPadMuted(!s0.soundOn);
  useSettings.subscribe((s, prev) => {
    if (s.soundOn !== prev.soundOn) audioEngine.setPadMuted(!s.soundOn);
    if (s.metronomeSubdivision !== prev.metronomeSubdivision) applySubdivision();
  });

  if (import.meta.env.DEV) (window as unknown as { __metronome?: typeof metronome }).__metronome = metronome;
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
