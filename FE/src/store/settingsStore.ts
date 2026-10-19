// 사용자 설정. localStorage에 영속.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_KIT_LAYOUT, type KitLayout, type PadId } from '@/domain/pads';
import { DEFAULT_TIMING, type TimingWindows } from '@/domain/judgement';
import type { CalibrationProfile, CaptureMode } from '@/domain/calibration';
import { DEFAULT_KEY_MAP, type KeyMap } from '@/domain/keyMap';

/** 센서 소스 선택 (설계 D9). 키보드는 항목이 아니라 항상 켜진 보조 소스 */
export type SensorKind = 'none' | 'pointer' | 'ble' | 'websocket';

interface SettingsState {
  sensorKind: SensorKind;
  keyMap: KeyMap;
  pointerHitKeys: { left: string; right: string };
  kitLayout: KitLayout;
  profile: CalibrationProfile | null;
  timing: TimingWindows;
  audioOffsetMs: number;
  /** 노트가 위에서 판정선까지 내려오는 시간 */
  scrollMs: number;
  wsUrl: string;
  calibrationMode: CaptureMode;
  holdMs: number;
  maxRadiusDeg: number;
  metronome: boolean;
  countInBars: number;
  volume: number;

  setSensorKind: (k: SensorKind) => void;
  bindKey: (code: string, pad: PadId, stickId: 0 | 1) => void;
  unbindKey: (code: string) => void;
  resetKeyMap: () => void;
  setPointerHitKeys: (k: { left: string; right: string }) => void;
  movePad: (pad: PadId, x: number, y: number) => void;
  resetLayout: () => void;
  setProfile: (p: CalibrationProfile | null) => void;
  setTiming: (t: TimingWindows) => void;
  setAudioOffsetMs: (v: number) => void;
  setScrollMs: (v: number) => void;
  setWsUrl: (v: string) => void;
  setCalibrationMode: (m: CaptureMode) => void;
  setHoldMs: (v: number) => void;
  setMaxRadiusDeg: (v: number) => void;
  setMetronome: (v: boolean) => void;
  setCountInBars: (v: number) => void;
  setVolume: (v: number) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      sensorKind: 'none',
      keyMap: DEFAULT_KEY_MAP,
      pointerHitKeys: { left: 'KeyF', right: 'KeyJ' },
      kitLayout: DEFAULT_KIT_LAYOUT,
      profile: null,
      timing: DEFAULT_TIMING,
      audioOffsetMs: 0,
      scrollMs: 1400,
      wsUrl: 'ws://localhost:8765',
      calibrationMode: 'hold',
      holdMs: 2000,
      maxRadiusDeg: 22,
      metronome: true,
      countInBars: 1,
      volume: 0.8,

      setSensorKind: (sensorKind) => set({ sensorKind }),
      bindKey: (code, pad, stickId) => set({ keyMap: { ...get().keyMap, [code]: { pad, stickId } } }),
      unbindKey: (code) => {
        const next = { ...get().keyMap };
        delete next[code];
        set({ keyMap: next });
      },
      resetKeyMap: () => set({ keyMap: DEFAULT_KEY_MAP }),
      setPointerHitKeys: (pointerHitKeys) => set({ pointerHitKeys }),
      movePad: (pad, x, y) =>
        set({ kitLayout: { ...get().kitLayout, [pad]: { ...get().kitLayout[pad], x, y } } }),
      resetLayout: () => set({ kitLayout: DEFAULT_KIT_LAYOUT }),
      setProfile: (profile) => set({ profile }),
      setTiming: (timing) => set({ timing }),
      setAudioOffsetMs: (audioOffsetMs) => set({ audioOffsetMs }),
      setScrollMs: (scrollMs) => set({ scrollMs }),
      setWsUrl: (wsUrl) => set({ wsUrl }),
      setCalibrationMode: (calibrationMode) => set({ calibrationMode }),
      setHoldMs: (holdMs) => set({ holdMs }),
      setMaxRadiusDeg: (maxRadiusDeg) => set({ maxRadiusDeg }),
      setMetronome: (metronome) => set({ metronome }),
      setCountInBars: (countInBars) => set({ countInBars }),
      setVolume: (volume) => set({ volume }),
    }),
    {
      name: 'ssaplash.settings',
      version: 2,
      // v1: inputKind(keyboard/pointer/ble/websocket) → v2: sensorKind(none/pointer/ble/websocket)
      migrate: (persisted, version) => {
        const p = persisted as Record<string, unknown>;
        if (version < 2) {
          const k = p.inputKind;
          p.sensorKind = k === 'pointer' || k === 'ble' || k === 'websocket' ? k : 'none';
          delete p.inputKind;
        }
        return p as unknown as SettingsState;
      },
    },
  ),
);
