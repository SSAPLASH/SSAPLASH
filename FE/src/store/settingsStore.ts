// 사용자 설정. localStorage에 영속. SETUP-04 프리셋의 0단계(로컬) 버전.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_KIT_LAYOUT, fillLayout, type KitLayout } from '@/domain/kitLayout';
import { withRadiusOverride, type HandAnchors, type HandAnchorSet, type PadAnchor } from '@/domain/calibration';
import { moveAnchorsForPad } from '@/domain/kitModel';
import { isKitSkin, type KitSkin } from '@/domain/drumKit';
import { isHitFxTheme } from '@/domain/hitFx/themes';
import type { HitFxTheme } from '@/domain/hitFx/types';
import { normalizePadKeys, type PadId } from '@/domain/pads';
import { DEFAULT_TIMING, type TimingWindows } from '@/domain/judgement';
import type { OptionValue, OptionValues, SensorId } from '@/domain/events';
import type { SoundSetId } from '@/audio/soundSets';
import { SYSTEM_PRESET_ID, isSystemPreset, type KitPreset, type PresetAnchorRecord, type PresetAnchors } from '@/domain/preset';
import { BPM_DEFAULT, BPM_MAX, BPM_MIN, type BeatsPerBar } from '@/domain/metronome';
import { DEFAULT_SENSOR_TUNING, mergeTuning, type PartialTuning, type SensorTuning } from '@/domain/tuning';

interface SettingsState {
  /** 센서 소스 선택 (설계 D9). 'none'이 아니면 입력 소스 레지스트리의 id. 키보드는 항목이 아니라 항상 켜진 보조 소스 */
  sensorKind: SensorId;
  /** 소스별 설정값 묶음. 항목 스키마는 입력 소스 디스크립터가 선언하고, 여기서는 내용을 모른다 */
  sensorOptions: Record<SensorId, OptionValues>;
  /** 화면 배치(표시 전용, PLAY-004 D2). 보정이 끝나면 앵커에서 유도한 값이 들어오고 프리셋 layout으로 저장된다 */
  kitLayout: KitLayout;
  presets: KitPreset[];
  /** 최초 설정(2타 보정·프리셋 적용)을 끝냈는지 */
  firstSetupDone: boolean;
  /**
   * 손별 판정 앵커(기기 로컬, PLAY-004 D1) — 적용 중 프리셋의 앵커 사본(UX-64 D2). null = 그 손은 보정 안 됨(모델 기본).
   * 시스템 기본이면 [null, null]. 판정·전송 경로(currentProfiles·pushTable)는 이 사본만 본다
   */
  stickAnchors: HandAnchors;
  /** 적용 중 프리셋의 보정 시각(Date.now). 없으면 null */
  calibratedAt: number | null;
  /** 프리셋별 앵커(기기 로컬, UX-64 D2). 키 = 프리셋 id. 시스템 기본은 항목이 없다 */
  presetAnchors: PresetAnchors;
  /** 지금 적용 중인 프리셋 id. 사용자 프리셋 id 또는 SYSTEM_PRESET_ID(시스템 기본). v18부터 null 없음 */
  activePresetId: string;
  timing: TimingWindows;
  audioOffsetMs: number;
  /** 노트가 위에서 판정선까지 내려오는 시간 */
  scrollMs: number;
  /** 센서 튜닝(반경 계수·상한, 세기 곡선, 시각 보정, 앵커 밖 정책). 디버그 창 튜닝 패널과 세팅 화면이 같은 값을 쓴다 */
  tuning: SensorTuning;
  metronome: boolean;
  countInBars: number;
  volume: number;
  /** 메트로놈 클릭 음량(0~1). 1 = 기존 클릭 크기. 전체 음량(volume)과 곱해진다 */
  metronomeVolume: number;
  /** 드럼(패드) 소리 음량(0~2). 1 = 기본. 전체 음량(volume)과 곱해진다 */
  drumVolume: number;
  /** 드럼 모양(기기별 로컬) */
  kitSkin: KitSkin;
  /** 타격 이펙트 테마(기기별 로컬). 기본 'auto' = 드럼 모양에 맞춘 기본 이펙트 */
  hitFxTheme: HitFxTheme;
  /** 타이밍 오차 막대 표시(게임 판정선 아래·악보 아래). 기본 켬 */
  timingBar: boolean;
  /** 노래(게임·악보 반주) 음량(0~1). 1 = 기본. 전체 음량(volume)과 곱해진다 */
  songVolume: number;
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

  setSensorKind: (k: SensorId) => void;
  setSensorOption: (id: SensorId, key: string, value: OptionValue) => void;
  /** 배치 교체(보정 완료·프리셋 적용). 빠진 패드는 기본값으로 채운다 */
  setKitLayout: (layout: Partial<KitLayout>) => void;
  resetLayout: () => void;
  /** 패드 하나를 (x, y)로 옮긴다(드래그 편집, kit-drag 설계 D2·D4). 0.05~0.95로 자르고 그 패드의 손별 앵커도 같이 옮긴다. presetAnchors 기록은 저장 때 갱신. 시스템 기본이면 무시 */
  movePad: (pad: PadId, x: number, y: number) => void;
  /**
   * 손별 앵커 저장(사본). at은 보정 시각(기본 지금). 적용 중인 것이 사용자 프리셋이면 presetAnchors[그 id]에도 같이 기록한다.
   * 시스템 기본이 적용 중이면 사본만 바뀐다(호출자는 시스템 기본에서 보정을 열지 않는다)
   */
  setStickAnchors: (anchors: HandAnchors, at?: number) => void;
  /** 앵커 전부 지우기(보정 전 상태로). 적용 중 사용자 프리셋의 기록도 지운다 */
  clearStickAnchors: () => void;
  /** 프리셋 하나의 앵커 기록(새 프리셋 저장·초안 반영). 적용 중 프리셋이면 사본도 같이 바꾼다 */
  setPresetAnchors: (id: string, record: PresetAnchorRecord) => void;
  /** 프리셋 삭제 때 그 앵커 기록을 지운다 */
  removePresetAnchors: (id: string) => void;
  /** 한 패드의 판정 반경을 양손 앵커에 덮어쓴다(UX-64 D9). 하한·상한은 tuning. 그 패드 앵커가 없는 손은 그대로 */
  setRadiusOverride: (pad: PadId, deg: number) => void;
  setFirstSetupDone: (v: boolean) => void;
  /** 적용 프리셋 바꾸기(사본은 presetStore.apply가 갈아끼운다) */
  setActivePresetId: (id: string) => void;
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
  setMetronomeVolume: (v: number) => void;
  setDrumVolume: (v: number) => void;
  setSongVolume: (v: number) => void;
  setKitSkin: (s: KitSkin) => void;
  setHitFxTheme: (t: HitFxTheme) => void;
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
  setTimingBar: (v: boolean) => void;
}

export type TestVelocity = 64 | 96 | 120;
export type GameView = 'highway' | 'kit';

export const SETTINGS_VERSION = 20;

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
 * v12 → v13: metronomeVolume(기본 1, 0~1 밖이거나 숫자가 아니면 1) 추가.
 * v13 → v14: statsConsent 삭제(연주 기록 활용 동의는 가입 때 필수, 서버 값만 쓴다). 저장돼 있던 값은 버린다.
 * v14 → v15: drumVolume(기본 1, 0~2)·songVolume(기본 1, 0~1) 추가. 없거나 숫자가 아니면 1, 범위 밖은 잘라 채운다.
 * v15 → v16: kitSkin(기본 'acoustic') 추가. 없거나 모르는 값이면 'acoustic'.
 * v16 → v17: stickAnchors([null, null])·calibratedAt(null) 추가(PLAY-004). tuning.minRadiusDeg는 merge가 기본값으로 채운다.
 * v17 → v18: presetAnchors({}) 추가, activePresetId null → 'system'(UX-64 D1). 적용 중이던 것이 사용자 프리셋이고 앵커가 있으면
 *            presetAnchors[그 id]로 복사(사본은 유지). 시스템 기본이면 사본·시각을 비운다(모델 기본 앵커로 판정).
 * v18 → v19: hitFxTheme(기본 'auto') 추가. 없거나 모르는 값이면 'auto'.
 * v19 → v20: timingBar(기본 true) 추가. boolean이 아니면 true.
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
  }
  if (version < 13) {
    const v = p.metronomeVolume;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) p.metronomeVolume = 1;
  }
  if (version < 14) delete p.statsConsent;
  if (version < 15) {
    p.drumVolume = clampVolume(p.drumVolume, 2);
    p.songVolume = clampVolume(p.songVolume, 1);
  }
  if (version < 16) p.kitSkin = isKitSkin(p.kitSkin) ? p.kitSkin : 'acoustic';
  if (version < 17) {
    p.stickAnchors = sanitizeAnchors(p.stickAnchors);
    p.calibratedAt = typeof p.calibratedAt === 'number' && Number.isFinite(p.calibratedAt) ? p.calibratedAt : null;
  }
  if (version < 18) {
    const active = typeof p.activePresetId === 'string' && p.activePresetId.length > 0 ? p.activePresetId : SYSTEM_PRESET_ID;
    const anchors = sanitizeAnchors(p.stickAnchors);
    const at = isFiniteNum(p.calibratedAt) ? p.calibratedAt : null;
    const records: PresetAnchors = {};
    if (!isSystemPreset(active) && (anchors[0] || anchors[1])) {
      records[active] = { anchors, calibratedAt: at ?? Date.now() };
    }
    p.activePresetId = active;
    p.presetAnchors = records;
    if (isSystemPreset(active)) {
      p.stickAnchors = [null, null];
      p.calibratedAt = null;
    }
  }
  if (version < 19) p.hitFxTheme = isHitFxTheme(p.hitFxTheme) ? p.hitFxTheme : 'auto';
  if (version < 20) p.timingBar = typeof p.timingBar === 'boolean' ? p.timingBar : true;
  return p as unknown as SettingsState;
}

/** 저장된 프리셋별 앵커를 검증한다. 형이 아니면 {}, 깨진 항목(앵커가 양손 다 없거나 시각이 숫자가 아님)은 버린다 */
export function sanitizePresetAnchors(raw: unknown): PresetAnchors {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: PresetAnchors = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    const anchors = sanitizeAnchors(r.anchors);
    if (!anchors[0] && !anchors[1]) continue;
    if (!isFiniteNum(r.calibratedAt)) continue;
    out[id] = { anchors, calibratedAt: r.calibratedAt };
  }
  return out;
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 저장된 앵커 하나를 검증한다. 숫자 필드가 깨졌으면 null */
function sanitizeAnchor(pad: PadId, raw: unknown): PadAnchor | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (!isFiniteNum(a.pitch) || !isFiniteNum(a.yaw)) return null;
  const out: PadAnchor = {
    pad,
    pitch: a.pitch,
    yaw: a.yaw,
    radius: isFiniteNum(a.radius) ? a.radius : 0,
    samples: isFiniteNum(a.samples) ? a.samples : 0,
    spread: isFiniteNum(a.spread) ? a.spread : 0,
  };
  if (isFiniteNum(a.radiusOverride)) out.radiusOverride = a.radiusOverride;
  return out;
}

/** 저장된 손별 앵커를 검증한다. 형이 아니면 [null, null], 손 안의 깨진 패드는 버린다 */
export function sanitizeAnchors(raw: unknown): HandAnchors {
  if (!Array.isArray(raw) || raw.length !== 2) return [null, null];
  const hand = (h: unknown): HandAnchorSet | null => {
    if (typeof h !== 'object' || h === null || Array.isArray(h)) return null;
    const out: HandAnchorSet = {};
    for (const [k, v] of Object.entries(normalizePadKeys(h as Record<string, unknown>))) {
      const a = sanitizeAnchor(k as PadId, v);
      if (a) out[k as PadId] = a;
    }
    return Object.keys(out).length ? out : null;
  };
  return [hand(raw[0]), hand(raw[1])];
}

/** 음량 값을 0~max로 자른다. 숫자가 아니면 기본값 1 */
function clampVolume(v: unknown, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 1;
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
      stickAnchors: [null, null],
      calibratedAt: null,
      presetAnchors: {},
      activePresetId: SYSTEM_PRESET_ID,
      timing: DEFAULT_TIMING,
      audioOffsetMs: 0,
      scrollMs: 1400,
      tuning: DEFAULT_SENSOR_TUNING,
      metronome: true,
      countInBars: 1,
      volume: 0.8,
      metronomeVolume: 1,
      drumVolume: 1,
      kitSkin: 'acoustic',
      hitFxTheme: 'auto',
      timingBar: true,
      songVolume: 1,
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

      setSensorKind: (sensorKind) => set({ sensorKind }),
      setSensorOption: (id, key, value) =>
        set({ sensorOptions: { ...get().sensorOptions, [id]: { ...get().sensorOptions[id], [key]: value } } }),
      setKitLayout: (layout) => set({ kitLayout: fillLayout(layout) }),
      resetLayout: () => set({ kitLayout: DEFAULT_KIT_LAYOUT }),
      movePad: (pad, x, y) => {
        const { activePresetId, kitLayout, stickAnchors, tuning } = get();
        if (isSystemPreset(activePresetId)) return;
        const clamp = (v: number) => Math.min(0.95, Math.max(0.05, v));
        const from = { x: kitLayout[pad].x, y: kitLayout[pad].y };
        const to = { x: clamp(x), y: clamp(y) };
        set({
          kitLayout: { ...kitLayout, [pad]: { ...kitLayout[pad], ...to } },
          stickAnchors: moveAnchorsForPad(stickAnchors, pad, from, to, tuning.angleRange),
        });
      },
      setStickAnchors: (anchors, at = Date.now()) => {
        const copy: HandAnchors = [anchors[0], anchors[1]];
        const { activePresetId, presetAnchors } = get();
        const records = isSystemPreset(activePresetId) ? presetAnchors : { ...presetAnchors, [activePresetId]: { anchors: copy, calibratedAt: at } };
        set({ stickAnchors: copy, calibratedAt: at, presetAnchors: records });
      },
      clearStickAnchors: () => {
        const { activePresetId, presetAnchors } = get();
        const records = { ...presetAnchors };
        delete records[activePresetId];
        set({ stickAnchors: [null, null], calibratedAt: null, presetAnchors: records });
      },
      setPresetAnchors: (id, record) => {
        const copy: PresetAnchorRecord = { anchors: [record.anchors[0], record.anchors[1]], calibratedAt: record.calibratedAt };
        const { activePresetId, presetAnchors } = get();
        const next: Partial<SettingsState> = { presetAnchors: { ...presetAnchors, [id]: copy } };
        if (activePresetId === id) {
          next.stickAnchors = copy.anchors;
          next.calibratedAt = copy.calibratedAt;
        }
        set(next);
      },
      removePresetAnchors: (id) => {
        const records = { ...get().presetAnchors };
        delete records[id];
        set({ presetAnchors: records });
      },
      setRadiusOverride: (pad, deg) => {
        const { stickAnchors, tuning, activePresetId, presetAnchors, calibratedAt } = get();
        const next: HandAnchors = [
          withRadiusOverride(stickAnchors[0], pad, deg, tuning.minRadiusDeg, tuning.maxRadiusDeg),
          withRadiusOverride(stickAnchors[1], pad, deg, tuning.minRadiusDeg, tuning.maxRadiusDeg),
        ];
        const records =
          isSystemPreset(activePresetId) || !presetAnchors[activePresetId]
            ? presetAnchors
            : { ...presetAnchors, [activePresetId]: { anchors: next, calibratedAt: calibratedAt ?? presetAnchors[activePresetId].calibratedAt } };
        set({ stickAnchors: next, presetAnchors: records });
      },
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
      setMetronomeVolume: (v) => set({ metronomeVolume: Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1)) }),
      setDrumVolume: (v) => set({ drumVolume: clampVolume(v, 2) }),
      setKitSkin: (s) => {
        if (isKitSkin(s)) set({ kitSkin: s });
      },
      setHitFxTheme: (t) => {
        if (isHitFxTheme(t)) set({ hitFxTheme: t });
      },
      setSongVolume: (v) => set({ songVolume: clampVolume(v, 1) }),
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
      setTimingBar: (timingBar) => set({ timingBar }),
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
          // 저장분에 없거나 범위 밖인 음량은 기본값·범위로 보정한다
          drumVolume: clampVolume(p.drumVolume, 2),
          songVolume: clampVolume(p.songVolume, 1),
          kitSkin: isKitSkin(p.kitSkin) ? p.kitSkin : 'acoustic',
          hitFxTheme: isHitFxTheme(p.hitFxTheme) ? p.hitFxTheme : 'auto',
          timingBar: typeof p.timingBar === 'boolean' ? p.timingBar : true,
          stickAnchors: sanitizeAnchors(p.stickAnchors),
          calibratedAt: isFiniteNum(p.calibratedAt) ? p.calibratedAt : null,
          presetAnchors: sanitizePresetAnchors(p.presetAnchors),
          activePresetId: typeof p.activePresetId === 'string' && p.activePresetId.length > 0 ? p.activePresetId : SYSTEM_PRESET_ID,
        };
      },
    },
  ),
);
