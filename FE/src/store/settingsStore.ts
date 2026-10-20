// 사용자 설정. localStorage에 영속. SETUP-04 프리셋의 0단계(로컬) 버전.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_KIT_LAYOUT, type KitLayout, type PadId } from '@/domain/pads';
import { DEFAULT_TIMING, type TimingWindows } from '@/domain/judgement';
import type { CalibrationProfile, CaptureMode } from '@/domain/calibration';
import { DEFAULT_KEY_MAP, type KeyMap } from '@/domain/keyMap';
import type { OptionValue, OptionValues, SensorId } from '@/domain/events';

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
  maxRadiusDeg: number;
  metronome: boolean;
  countInBars: number;
  volume: number;

  setSensorKind: (k: SensorId) => void;
  setSensorOption: (id: SensorId, key: string, value: OptionValue) => void;
  bindKey: (code: string, pad: PadId, stickId: 0 | 1) => void;
  unbindKey: (code: string) => void;
  resetKeyMap: () => void;
  movePad: (pad: PadId, x: number, y: number) => void;
  resetLayout: () => void;
  setProfile: (p: CalibrationProfile | null) => void;
  savePreset: (name: string) => void;
  loadPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  setTiming: (t: TimingWindows) => void;
  setAudioOffsetMs: (v: number) => void;
  setScrollMs: (v: number) => void;
  setCalibrationMode: (m: CaptureMode) => void;
  setHoldMs: (v: number) => void;
  setMaxRadiusDeg: (v: number) => void;
  setMetronome: (v: boolean) => void;
  setCountInBars: (v: number) => void;
  setVolume: (v: number) => void;
}

export const SETTINGS_VERSION = 3;

/**
 * 저장된 설정 이행.
 * v1 → v2: inputKind(keyboard/pointer/ble/websocket) → sensorKind(none/pointer/ble/websocket)
 * v2 → v3: 최상위 pointerHitKeys·wsUrl → sensorOptions(소스별 설정 묶음). 옛 필드는 지운다.
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
      maxRadiusDeg: 22,
      metronome: true,
      countInBars: 1,
      volume: 0.8,

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
      setMaxRadiusDeg: (maxRadiusDeg) => set({ maxRadiusDeg }),
      setMetronome: (metronome) => set({ metronome }),
      setCountInBars: (countInBars) => set({ countInBars }),
      setVolume: (volume) => set({ volume }),
    }),
    {
      name: 'ssaplash.settings',
      version: SETTINGS_VERSION,
      migrate: migrateSettings,
    },
  ),
);
