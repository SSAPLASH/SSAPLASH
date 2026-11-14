// 타격 이펙트 테마 목록·이름·정의 조회. 테마는 "데이터 + 생성 함수"이고 그리는 일은 공통 엔진이 한다.
import type { KitSkin, PadShape } from '@/domain/kit/drumKit';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle, FxSheetId, HitFxTheme } from './types';
import { spawnAuto } from './spawn/auto';
import { spawnElectric } from './spawn/electric';
import { ELECTRIC_PALETTE, spawnElectricLite } from './spawn/electricLite';
import { spawnFire } from './spawn/fire';
import { FIRE_PALETTE, spawnFireLite } from './spawn/fireLite';
import { INK_MAX_LIFE_MS, INK_PALETTE, spawnInk } from './spawn/ink';
import { PIXEL_PALETTE, spawnPixel } from './spawn/pixel';
import { spawnWater } from './spawn/water';
import { WATER_PALETTE, spawnWaterLite } from './spawn/waterLite';
import { MAX_LIFE_MS, MAX_SPAWN, spawnReduced } from './spawn/util';

export type FxBlend = 'normal' | 'additive';

export type FxSpawn = (event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette) => FxParticle[];

export interface HitFxThemeDef {
  id: HitFxTheme;
  label: string;
  description: string;
  /** 스킨·패드 모양별 색. brand는 캔버스에서 CSS 변수를 못 쓰므로 엔진이 읽어 넘긴다 */
  palette: (skin: KitSkin, shape: PadShape, brand: string) => FxPalette;
  blend: FxBlend;
  spawn: FxSpawn;
  /** 연속 그림 묶음(물·불·전기 각 4개, 나머지는 빈 목록). 엔진이 고른 테마의 것만 불러온다 */
  sheets: readonly FxSheetId[];
  /** 그림이 준비되지 않았거나 못 불러올 때 쓰는 입자만의 생성 함수. 그림이 없는 테마는 spawn과 같다 */
  spawnLite: FxSpawn;
  /** 모션 줄이기용: 움직임 없이 밝기만 잠깐 바뀌는 덩어리 */
  spawnReduced: FxSpawn;
  /** 한 타에서 테마가 만드는 파티클 상한(판정 이펙트는 따로 센다) */
  maxSpawn: number;
  /** 킷 높이 대비 위쪽 캔버스 여백. 그림이 헤드 위로 솟는 테마가 크다 */
  bleedTop: number;
  /** 파티클 수명 상한(시작 지연 포함, ms) */
  maxLifeMs: number;
}

const WATER_SHEETS: readonly FxSheetId[] = ['water-side-a', 'water-side-b', 'water-cymbal', 'water-front'];
const FIRE_SHEETS: readonly FxSheetId[] = ['fire-side-a', 'fire-side-b', 'fire-cymbal', 'fire-front'];
const BOLT_SHEETS: readonly FxSheetId[] = ['bolt-side-a', 'bolt-side-b', 'bolt-cymbal', 'bolt-front'];
/** 그림이 없는 테마의 위쪽 여백(사방 기본 여백과 같다) */
const BLEED_TOP_DEFAULT = 0.12;

/** 네온 스킨 모양별 색(drum.css의 --neon과 같은 값) */
const NEON_COLOR: Record<PadShape, string> = { drum: '#22e4ff', cymbal: '#ffc24a', kick: '#ff3ec8', pedal: '#ffc24a' };

/** brand 토큰을 읽지 못할 때의 값(tokens.css --brand) */
export const BRAND_FALLBACK = '#35a3d4';

function autoPalette(skin: KitSkin, shape: PadShape, brand: string): FxPalette {
  const main = skin === 'neon' ? NEON_COLOR[shape] : brand;
  const sub = skin === 'acoustic' ? '#FBE7A6' : skin === 'electronic' ? '#FFFFFF' : '#FFC24A';
  return { main, sub, glow: main };
}

const DEFS: Record<HitFxTheme, HitFxThemeDef> = {
  auto: {
    id: 'auto',
    label: '기본',
    description: '드럼 모양에 맞춘 충격파 링. 심벌에는 스파크가 튀어요',
    palette: autoPalette,
    blend: 'normal',
    spawn: spawnAuto,
    sheets: [],
    spawnLite: spawnAuto,
    spawnReduced,
    maxSpawn: MAX_SPAWN,
    bleedTop: BLEED_TOP_DEFAULT,
    maxLifeMs: MAX_LIFE_MS,
  },
  electric: {
    id: 'electric',
    label: '전기',
    description: '방전이 헤드를 타고 퍼지며 번쩍여요',
    palette: () => ELECTRIC_PALETTE,
    blend: 'additive',
    spawn: spawnElectric,
    sheets: BOLT_SHEETS,
    spawnLite: spawnElectricLite,
    spawnReduced,
    maxSpawn: 12,
    bleedTop: 0.35,
    maxLifeMs: 360,
  },
  water: {
    id: 'water',
    label: '물',
    description: '물막이 솟아 가닥이 되고 방울로 흩어져요',
    palette: () => WATER_PALETTE,
    blend: 'normal',
    spawn: spawnWater,
    sheets: WATER_SHEETS,
    spawnLite: spawnWaterLite,
    spawnReduced,
    maxSpawn: 16,
    bleedTop: 0.4,
    maxLifeMs: 640,
  },
  fire: {
    id: 'fire',
    label: '불',
    description: '불길이 갈라져 솟고 불티가 날아올라요',
    palette: () => FIRE_PALETTE,
    blend: 'additive',
    spawn: spawnFire,
    sheets: FIRE_SHEETS,
    spawnLite: spawnFireLite,
    spawnReduced,
    maxSpawn: 12,
    bleedTop: 0.35,
    maxLifeMs: 640,
  },
  ink: {
    id: 'ink',
    label: '잉크',
    description: '먹물이 튀어 번지다 사라져요',
    palette: () => INK_PALETTE,
    blend: 'normal',
    spawn: spawnInk,
    sheets: [],
    spawnLite: spawnInk,
    spawnReduced,
    maxSpawn: MAX_SPAWN,
    bleedTop: BLEED_TOP_DEFAULT,
    maxLifeMs: INK_MAX_LIFE_MS,
  },
  pixel: {
    id: 'pixel',
    label: '픽셀',
    description: '네모 블록이 툭툭 끊기며 흩어져요',
    palette: () => PIXEL_PALETTE,
    blend: 'normal',
    spawn: spawnPixel,
    sheets: [],
    spawnLite: spawnPixel,
    spawnReduced,
    maxSpawn: MAX_SPAWN,
    bleedTop: BLEED_TOP_DEFAULT,
    maxLifeMs: MAX_LIFE_MS,
  },
};

/** 출시 테마 목록(설정 선택 화면 순서). 후보 선정은 랩 비교 후 사용자가 한다 */
export const HIT_FX_THEMES: readonly HitFxTheme[] = ['auto', 'electric', 'water', 'fire'];

/** 랩 전체 테마 6종(숫자 키 1~6 순서). 저장값 검사(isHitFxTheme)는 이 목록 기준이다 */
export const HIT_FX_LAB_THEMES: readonly HitFxTheme[] = ['auto', 'electric', 'water', 'fire', 'ink', 'pixel'];

export const HIT_FX_THEME_LABELS: Record<HitFxTheme, string> = {
  auto: DEFS.auto.label,
  electric: DEFS.electric.label,
  water: DEFS.water.label,
  fire: DEFS.fire.label,
  ink: DEFS.ink.label,
  pixel: DEFS.pixel.label,
};

export function isHitFxTheme(v: unknown): v is HitFxTheme {
  return typeof v === 'string' && (HIT_FX_LAB_THEMES as readonly string[]).includes(v);
}

export function hitFxThemeDef(id: HitFxTheme): HitFxThemeDef {
  return DEFS[id];
}
