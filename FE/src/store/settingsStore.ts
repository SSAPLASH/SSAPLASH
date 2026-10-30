// 사용자 설정. localStorage에 영속. SETUP-04 프리셋의 0단계(로컬) 버전.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_KIT_LAYOUT, KIT_LAYOUT_PRESETS, fillLayout, type KitLayout, type KitLayoutPresetId } from '@/domain/kitLayout';
import { normalizePadKeys, type PadId } from '@/domain/pads';
import { DEFAULT_TIMING, type TimingWindows } from '@/domain/judgement';
import type { OptionValue, OptionValues, SensorId } from '@/domain/events';
import type { SoundSetId } from '@/audio/soundSets';
import type { KitPreset } from '@/domain/preset';
import { BPM_DEFAULT, BPM_MAX, BPM_MIN, type BeatsPerBar } from '@/domain/metronome';
import { DEFAULT_SENSOR_TUNING, mergeTuning, type PartialTuning, type SensorTuning } from '@/domain/tuning';

interface SettingsState {
  /** 센서 소스 선택 (설계 D9). 'none'이 아니면 입력 소스 레지스트리의 id. 키보드는 항목이 아니라 항상 켜진 보조 소스 */
  sensorKind: SensorId;
  /** 소스별 설정값 묶음. 항목 스키마는 입력 소스 디스크립터가 선언하고, 여기서는 내용을 모른다 */
  sensorOptions: Record<SensorId, OptionValues>;
  kitLayout: KitLayout;
  presets: KitPreset[];
  /** 최초 설정(3초 보정·배치·프리셋 적용)을 끝냈는지 */
  firstSetupDone: boolean;
  /** 지금 적용 중인 프리셋. 없으면 null */
  activePresetId: string | null;
  timing: TimingWindows;
  audioOffsetMs: number;
  /** 노트가 위에서 판정선까지 내려오는 시간 */
  scrollMs: number;
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
  /** 악보 연주 드럼 가이드의 박 라벨 표시 */
  sheetPadCount: boolean;
  /** 사이드바 접힘(≤1024에서는 셸이 강제로 접는다) */
  sidebarCollapsed: boolean;
  /** 상단 Dock 접힘(알약) */
  dockCollapsed: boolean;
  /** 실시간 코칭 사용(COACH-001) */
  liveCoach: boolean;
  /** 연주 기록 활용 동의. 저장만 하고 업로드에는 아직 싣지 않는다 */
  statsConsent: boolean;

  setSensorKind: (k: SensorId) => void;
  setSensorOption: (id: SensorId, key: string, value: OptionValue) => void;
  movePad: (pad: PadId, x: number, y: number) => void;
  resetLayout: () => void;
  applyLayoutPreset: (id: KitLayoutPresetId) => void;
  setFirstSetupDone: (v: boolean) => void;
  setActivePresetId: (id: string | null) => void;
  /** 프리셋 저장소 교체. LocalPresetSource만 부른다(화면은 presetStore를 쓴다) */
  setPresets: (list: KitPreset[]) => void;
  setTiming: (t: TimingWindows) => void;
  setAudioOffsetMs: (v: number) => void;
  setScrollMs: (v: number) => void;
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
  setSheetPadCount: (v: boolean) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setDockCollapsed: (v: boolean) => void;
  setLiveCoach: (v: boolean) => void;
  setStatsConsent: (v: boolean) => void;
}

export type TestVelocity = 64 | 96 | 120;
export type GameView = 'highway' | 'kit';

export const SETTINGS_VERSION = 12;

/**
 * 저장된 설정 이행.
 * v1 → v2: inputKind(keyboard/pointer/ble/websocket) → sensorKind(none/pointer/ble/websocket)
 * v2 → v3: 최상위 pointerHitKeys·wsUrl → sensorOptions(소스별 설정 묶음). 옛 필드는 지운다.
 * v3 → v4: 최상위 maxRadiusDeg → tuning.maxRadiusDeg. 나머지 튜닝 값은 기본값.
 * v4 → v5: soundSetId(기본 'ssaplash')·testVelocity(기본 96) 추가.
 * v5 → v6: gameView(기본 'highway') 추가. 알 수 없는 값은 'highway'.
 * v6 → v7: metronomeBpm(기본 120, 범위 밖이면 120)·metronomeBeatsPerBar(3이 아니면 4)·soundOn(boolean 아니면 true) 추가.
 * v7 → v8: keyMap 삭제(키 매핑 설정 폐기). presets[] 각 항목에서 keyMap·profile 삭제, soundSetId가 없으면 현재 설정 soundSetId(없으면 'ssaplash')로 채움. layout 없는 프리셋은 버림.
 * v8 → v9: profile·calibrationMode·holdMs 삭제(판정 프로필은 배치에서 유도). firstSetupDone=false, activePresetId=presets[0]?.id ?? null 추가. 프리셋에 isDefault(첫 항목)·schemaVersion 1·updatedAt(=createdAt) 채움.
 * v9 → v10: 패드 이름 `HI_TOM` → `SMALL_TOM`, 없는 패드(MID_TOM·HIHAT_PEDAL 등)는 기본 배치로 보충. 최상위 kitLayout과 presets[].layout에 적용(객체가 아닌 layout의 프리셋은 버림).
 * v10 → v11: sheetPadCount(기본 true) 추가.
 * v11 → v12: sidebarCollapsed(false)·dockCollapsed(false)·liveCoach(true)·statsConsent(false) 추가. 기존 값은 보존하고 boolean이 아닌 값만 기본값으로.
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
  if (version < 8) {
    delete p.keyMap;
    const fallback = p.soundSetId === 'synth' || p.soundSetId === 'ssaplash' ? p.soundSetId : 'ssaplash';
    const list = Array.isArray(p.presets) ? (p.presets as unknown[]) : [];
    p.presets = list
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !!(x as Record<string, unknown>).layout)
      .map((x) => {
        const { keyMap: _keyMap, profile: _profile, ...rest } = x;
        void _keyMap;
        void _profile;
        return { ...rest, soundSetId: rest.soundSetId === 'synth' || rest.soundSetId === 'ssaplash' ? rest.soundSetId : fallback };
      });
  }
  if (version < 9) {
    delete p.profile;
    delete p.calibrationMode;
    delete p.holdMs;
    const list = Array.isArray(p.presets) ? (p.presets as Record<string, unknown>[]) : [];
    p.presets = list.map((x, i) => ({ ...x, isDefault: i === 0, schemaVersion: 1, updatedAt: x.createdAt }));
    p.firstSetupDone = false;
    p.activePresetId = (list[0]?.id as string | undefined) ?? null;
  }
  if (version < 10) {
    p.kitLayout = migrateLayout(p.kitLayout) ?? DEFAULT_KIT_LAYOUT;
    const list = Array.isArray(p.presets) ? (p.presets as Record<string, unknown>[]) : [];
    p.presets = list.flatMap((x) => {
      const layout = migrateLayout(x?.layout);
      return layout ? [{ ...x, layout }] : [];
    });
  }
  if (version < 11) p.sheetPadCount = true;
  if (version < 12) {
    if (typeof p.sidebarCollapsed !== 'boolean') p.sidebarCollapsed = false;
    if (typeof p.dockCollapsed !== 'boolean') p.dockCollapsed = false;
    if (typeof p.liveCoach !== 'boolean') p.liveCoach = true;
    if (typeof p.statsConsent !== 'boolean') p.statsConsent = false;
  }
  return p as unknown as SettingsState;
}

/** 저장된 배치의 옛 패드 이름을 바꾸고 빠진 패드를 기본 배치로 채운다. 객체가 아니면 null */
function migrateLayout(raw: unknown): KitLayout | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return fillLayout(normalizePadKeys(raw as Record<string, KitLayout[PadId]>));
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      sensorKind: 'none',
      sensorOptions: {},
      kitLayout: DEFAULT_KIT_LAYOUT,
      presets: [],
      firstSetupDone: false,
      activePresetId: null,
      timing: DEFAULT_TIMING,
      audioOffsetMs: 0,
      scrollMs: 1400,
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
      sheetPadCount: true,
      sidebarCollapsed: false,
      dockCollapsed: false,
      liveCoach: true,
      statsConsent: false,

      setSensorKind: (sensorKind) => set({ sensorKind }),
      setSensorOption: (id, key, value) =>
        set({ sensorOptions: { ...get().sensorOptions, [id]: { ...get().sensorOptions[id], [key]: value } } }),
      movePad: (pad, x, y) =>
        set({ kitLayout: { ...get().kitLayout, [pad]: { ...get().kitLayout[pad], x, y } } }),
      resetLayout: () => set({ kitLayout: DEFAULT_KIT_LAYOUT }),
      applyLayoutPreset: (id) => set({ kitLayout: KIT_LAYOUT_PRESETS[id] }),
      setFirstSetupDone: (firstSetupDone) => set({ firstSetupDone }),
      setActivePresetId: (activePresetId) => set({ activePresetId }),
      setPresets: (presets) => set({ presets }),
      setTiming: (timing) => set({ timing }),
      setAudioOffsetMs: (audioOffsetMs) => set({ audioOffsetMs }),
      setScrollMs: (scrollMs) => set({ scrollMs }),
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
      setSheetPadCount: (sheetPadCount) => set({ sheetPadCount }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setDockCollapsed: (dockCollapsed) => set({ dockCollapsed }),
      setLiveCoach: (liveCoach) => set({ liveCoach }),
      setStatsConsent: (statsConsent) => set({ statsConsent }),
    }),
    {
      name: 'ssaplash.settings',
      version: SETTINGS_VERSION,
      migrate: migrateSettings,
      // 저장된 tuning에 빠진 키(나중에 추가된 항목)는 기본값으로 채우고 범위 밖 값은 자른다
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          // 저장분에 패드 키가 빠져 있어도 런타임이 깨지지 않게 채운다
          kitLayout: fillLayout(p.kitLayout ?? {}),
          tuning: mergeTuning(DEFAULT_SENSOR_TUNING, p.tuning ?? {}),
        };
      },
    },
  ),
);
