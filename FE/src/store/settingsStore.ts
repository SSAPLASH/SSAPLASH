// 사용자 설정. localStorage에 영속. SETUP-04 프리셋의 0단계(로컬) 버전.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_KIT_LAYOUT, KIT_LAYOUT_PRESETS, type KitLayout, type KitLayoutPresetId } from '@/domain/kitLayout';
import type { PadId } from '@/domain/pads';
import { DEFAULT_TIMING, type TimingWindows } from '@/domain/judgement';
import type { CalibrationProfile, CaptureMode } from '@/domain/calibration';
import { DEFAULT_KEY_MAP, type KeyMap } from '@/domain/keyMap';
import type { OptionValue, OptionValues, SensorId } from '@/domain/events';
import type { SoundSetId } from '@/audio/soundSets';
import { BPM_DEFAULT, BPM_MAX, BPM_MIN, type BeatsPerBar } from '@/domain/metronome';
import { DEFAULT_SENSOR_TUNING, mergeTuning, type PartialTuning, type SensorTuning } from '@/domain/tuning';

export interface KitPreset {
  id: string;
  name: string;
  createdAt: string;
  layout: KitLayout;
  keyMap: KeyMap;
  profile: CalibrationProfile | null;
}

interface SettingsState {
  /** 센서 소스 선택 (설계 D9). 'none'이 아니면 입력 소스 레지스트리의 id. 키보드는 항목이 아니라 항상 켜진 보조 소스 */
  sensorKind: SensorId;
  /** 소스별 설정값 묶음. 항목 스키마는 입력 소스 디스크립터가 선언하고, 여기서는 내용을 모른다 */
  sensorOptions: Record<SensorId, OptionValues>;
  keyMap: KeyMap;
  kitLayout: KitLayout;
  profile: CalibrationProfile | null;
  presets: KitPreset[];
  timing: TimingWindows;
  audioOffsetMs: number;
  /** 노트가 위에서 판정선까지 내려오는 시간 */
  scrollMs: number;
  calibrationMode: CaptureMode;
  holdMs: number;
  /** 센서 튜닝(반경 계수·상한, 세기 곡선, 시각 보정, 앵커 밖 정책). 디버그 창 튜닝 패널과 세팅 화면이 같은 값을 쓴다 */
  tuning: SensorTuning;
  metronome: boolean;
  countInBars: number;
  volume: number;
  /** 사운드 세트 ('ssaplash' 샘플 키트 / 'synth' 합성음) */
  soundSetId: SoundSetId;
  /** 세팅 화면 톡 치기 세기: 약 64 · 보통 96 · 강 120 */
  testVelocity: TestVelocity;
  /** 리듬 게임 뷰: 'highway' 노트 레인 / 'kit' 세팅한 킷 위 연주 */
  gameView: GameView;
  /** 전역 메트로놈 마지막 BPM(영속 사본. 값의 주인은 엔진) */
  metronomeBpm: number;
  metronomeBeatsPerBar: BeatsPerBar;
  /** 패드 소리 on/off. 메트로놈 클릭은 영향 없음 */
  soundOn: boolean;

  setSensorKind: (k: SensorId) => void;
  setSensorOption: (id: SensorId, key: string, value: OptionValue) => void;
  bindKey: (code: string, pad: PadId, stickId: 0 | 1) => void;
  unbindKey: (code: string) => void;
  resetKeyMap: () => void;
  movePad: (pad: PadId, x: number, y: number) => void;
  resetLayout: () => void;
  applyLayoutPreset: (id: KitLayoutPresetId) => void;
  setProfile: (p: CalibrationProfile | null) => void;
  savePreset: (name: string) => void;
  loadPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  setTiming: (t: TimingWindows) => void;
  setAudioOffsetMs: (v: number) => void;
  setScrollMs: (v: number) => void;
  setCalibrationMode: (m: CaptureMode) => void;
  setHoldMs: (v: number) => void;
  /** 부분 갱신. 범위 보정(clampTuning)을 거쳐 병합한다 */
  setTuning: (partial: PartialTuning) => void;
  resetTuning: () => void;
  setMetronome: (v: boolean) => void;
  setCountInBars: (v: number) => void;
  setVolume: (v: number) => void;
  setSoundSetId: (id: SoundSetId) => void;
  setTestVelocity: (v: TestVelocity) => void;
  setGameView: (v: GameView) => void;
  /** bootstrap만 부른다(엔진 → 영속). 화면은 엔진 메서드를 부른다 */
  setMetronomeBpm: (v: number) => void;
  setMetronomeBeatsPerBar: (v: BeatsPerBar) => void;
  setSoundOn: (v: boolean) => void;
}

export type TestVelocity = 64 | 96 | 120;
export type GameView = 'highway' | 'kit';

export const SETTINGS_VERSION = 7;

/**
 * 저장된 설정 이행.
 * v1 → v2: inputKind(keyboard/pointer/ble/websocket) → sensorKind(none/pointer/ble/websocket)
 * v2 → v3: 최상위 pointerHitKeys·wsUrl → sensorOptions(소스별 설정 묶음). 옛 필드는 지운다.
 * v3 → v4: 최상위 maxRadiusDeg → tuning.maxRadiusDeg. 나머지 튜닝 값은 기본값.
 * v4 → v5: soundSetId(기본 'ssaplash')·testVelocity(기본 96) 추가.
 * v5 → v6: gameView(기본 'highway') 추가. 알 수 없는 값은 'highway'.
 * v6 → v7: metronomeBpm(기본 120, 범위 밖이면 120)·metronomeBeatsPerBar(3이 아니면 4)·soundOn(boolean 아니면 true) 추가.
 * 알 수 없는 sensorKind는 여기서 건드리지 않는다 — 레지스트리를 아는 bootstrap이 'none'으로 되돌린다(R6).
 */
export function migrateSettings(persisted: unknown, version: number): SettingsState {
  const p = persisted as Record<string, unknown>;
  if (version < 2) {
    const k = p.inputKind;
    p.sensorKind = k === 'pointer' || k === 'ble' || k === 'websocket' ? k : 'none';
    delete p.inputKind;
  }
  if (version < 3) {
    const options: Record<SensorId, OptionValues> = { ...(p.sensorOptions as Record<SensorId, OptionValues> | undefined) };
    const keys = p.pointerHitKeys as { left?: unknown; right?: unknown } | undefined;
    if (keys && typeof keys.left === 'string' && typeof keys.right === 'string') {
      options.pointer = { ...options.pointer, leftHitKey: keys.left, rightHitKey: keys.right };
    }
    if (typeof p.wsUrl === 'string') options.websocket = { ...options.websocket, url: p.wsUrl };
    p.sensorOptions = options;
    delete p.pointerHitKeys;
    delete p.wsUrl;
  }
  if (version < 4) {
    const moved = typeof p.maxRadiusDeg === 'number' ? { maxRadiusDeg: p.maxRadiusDeg } : {};
    p.tuning = mergeTuning(DEFAULT_SENSOR_TUNING, { ...(p.tuning as PartialTuning | undefined), ...moved });
    delete p.maxRadiusDeg;
  }
  if (version < 5) {
    if (p.soundSetId !== 'synth' && p.soundSetId !== 'ssaplash') p.soundSetId = 'ssaplash';
    if (p.testVelocity !== 64 && p.testVelocity !== 96 && p.testVelocity !== 120) p.testVelocity = 96;
  }
  if (version < 6) {
    if (p.gameView !== 'highway' && p.gameView !== 'kit') p.gameView = 'highway';
  }
  if (version < 7) {
    const bpm = p.metronomeBpm;
    if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) p.metronomeBpm = BPM_DEFAULT;
    if (p.metronomeBeatsPerBar !== 3) p.metronomeBeatsPerBar = 4;
    if (typeof p.soundOn !== 'boolean') p.soundOn = true;
  }
  return p as unknown as SettingsState;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      sensorKind: 'none',
      sensorOptions: {},
      keyMap: DEFAULT_KEY_MAP,
      kitLayout: DEFAULT_KIT_LAYOUT,
      profile: null,
      presets: [],
      timing: DEFAULT_TIMING,
      audioOffsetMs: 0,
      scrollMs: 1400,
      calibrationMode: 'hold',
      holdMs: 2000,
      tuning: DEFAULT_SENSOR_TUNING,
      metronome: true,
      countInBars: 1,
      volume: 0.8,
      soundSetId: 'ssaplash',
      testVelocity: 96,
      gameView: 'highway',
      metronomeBpm: BPM_DEFAULT,
      metronomeBeatsPerBar: 4,
      soundOn: true,

      setSensorKind: (sensorKind) => set({ sensorKind }),
      setSensorOption: (id, key, value) =>
        set({ sensorOptions: { ...get().sensorOptions, [id]: { ...get().sensorOptions[id], [key]: value } } }),
      bindKey: (code, pad, stickId) => set({ keyMap: { ...get().keyMap, [code]: { pad, stickId } } }),
      unbindKey: (code) => {
        const next = { ...get().keyMap };
        delete next[code];
        set({ keyMap: next });
      },
      resetKeyMap: () => set({ keyMap: DEFAULT_KEY_MAP }),
      movePad: (pad, x, y) =>
        set({ kitLayout: { ...get().kitLayout, [pad]: { ...get().kitLayout[pad], x, y } } }),
      resetLayout: () => set({ kitLayout: DEFAULT_KIT_LAYOUT }),
      applyLayoutPreset: (id) => set({ kitLayout: KIT_LAYOUT_PRESETS[id] }),
      setProfile: (profile) => set({ profile }),
      savePreset: (name) => {
        const s = get();
        const preset: KitPreset = {
          id: `preset-${Date.now().toString(36)}`,
          name,
          createdAt: new Date().toISOString(),
          layout: s.kitLayout,
          keyMap: s.keyMap,
          profile: s.profile,
        };
        set({ presets: [preset, ...s.presets].slice(0, 10) });
      },
      loadPreset: (id) => {
        const p = get().presets.find((x) => x.id === id);
        if (p) set({ kitLayout: p.layout, keyMap: p.keyMap, profile: p.profile });
      },
      deletePreset: (id) => set({ presets: get().presets.filter((x) => x.id !== id) }),
      setTiming: (timing) => set({ timing }),
      setAudioOffsetMs: (audioOffsetMs) => set({ audioOffsetMs }),
      setScrollMs: (scrollMs) => set({ scrollMs }),
      setCalibrationMode: (calibrationMode) => set({ calibrationMode }),
      setHoldMs: (holdMs) => set({ holdMs }),
      setTuning: (partial) => set({ tuning: mergeTuning(get().tuning, partial) }),
      resetTuning: () => set({ tuning: DEFAULT_SENSOR_TUNING }),
      setMetronome: (metronome) => set({ metronome }),
      setCountInBars: (countInBars) => set({ countInBars }),
      setVolume: (volume) => set({ volume }),
      setSoundSetId: (soundSetId) => set({ soundSetId }),
      setTestVelocity: (testVelocity) => set({ testVelocity }),
      setGameView: (gameView) => set({ gameView }),
      setMetronomeBpm: (metronomeBpm) => set({ metronomeBpm }),
      setMetronomeBeatsPerBar: (metronomeBeatsPerBar) => set({ metronomeBeatsPerBar }),
      setSoundOn: (soundOn) => set({ soundOn }),
    }),
    {
      name: 'ssaplash.settings',
      version: SETTINGS_VERSION,
      migrate: migrateSettings,
      // 저장된 tuning에 빠진 키(나중에 추가된 항목)는 기본값으로 채우고 범위 밖 값은 자른다
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { ...current, ...p, tuning: mergeTuning(DEFAULT_SENSOR_TUNING, p.tuning ?? {}) };
      },
    },
  ),
);
