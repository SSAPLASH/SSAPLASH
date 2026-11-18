// 타격 이펙트 공용 타입 — 이벤트(FxEvent)·테마 id·파티클·강도. 그리기·상태는 여기 없다.
import type { PadId } from '@/domain/kit/pads';
import type { PadShape } from '@/domain/kit/drumKit';
import type { Judgement } from '@/domain/play/judgement';

/** 이펙트가 나오는 화면. 1단계에서는 미리보기·랩의 크기 조정에만 쓴다 */
export type FxMode = 'free' | 'game' | 'sheet' | 'lab' | 'preview';

/** 타격 한 번의 이펙트 입력. 판정·빠름/늦음·콤보는 2·3단계가 채운다(1단계는 항상 null) */
export interface FxEvent {
  /** 타격마다 유일(liveStore hitSeq, 랩·미리보기는 자체 증가). 결정적 난수 씨앗 */
  seq: number;
  /** 표시 패드(visualPadOf 적용 후) */
  pad: PadId;
  /** 세기 0~127 */
  velocity: number;
  mode: FxMode;
  /** 게임·악보에서 판정된 타격 = PERFECT/GOOD, 놓친 노트 = MISS. 자유 연주·준비 단계 = null */
  judgement: Judgement | null;
  /** 빠름 음수, 늦음 양수. MISS·헛침은 null */
  deltaMs: number | null;
  combo: number | null;
  /** 판정 중인데 맞는 노트가 없는 타격(헛침). judgement는 null. 없으면 false */
  stray?: boolean;
  /** 하이웨이·악보가 노트 위치를 찾는 데 쓴다. 없으면 null */
  noteIndex?: number | null;
}

/** 테마 id 전체(랩 6종). 설정에 노출하는 출시 목록은 themes.ts의 HIT_FX_THEMES */
export type HitFxTheme = 'auto' | 'electric' | 'water' | 'fire' | 'ink' | 'pixel';

/** 엔진이 그리는 기본 도형 6종 */
export type FxKind = 'ring' | 'dot' | 'bolt' | 'blob' | 'pixel' | 'shard' | 'sheet' | 'drop';

/** 진행 p에서 out = 1-(1-p)², expo = 1-2^(-10p), step12 = 12fps 계단 */
export type FxEase = 'out' | 'linear' | 'step12' | 'expo';

/** 연속 그림(스프라이트 시트) 묶음 id. 테마 3 × 종류 4 = 12개. 정의 표는 sheets.ts */
export type FxSheetId =
  | 'water-side-a'
  | 'water-side-b'
  | 'water-cymbal'
  | 'water-front'
  | 'fire-side-a'
  | 'fire-side-b'
  | 'fire-cymbal'
  | 'fire-front'
  | 'bolt-side-a'
  | 'bolt-side-b'
  | 'bolt-cymbal'
  | 'bolt-front';

/** 파티클별 합성 방식. 없으면 테마의 blend를 따른다 */
export type FxBlendMode = 'add' | 'normal';

/** 파티클 한 개. 좌표·크기는 킷 좌표계(760×300), 선 두께(w0·w1)는 화면 px */
export interface FxParticle {
  kind: FxKind;
  x: number;
  y: number;
  /** 초당 이동량(킷 좌표) */
  vx: number;
  vy: number;
  /** 초당 가속(중력 등) */
  ax: number;
  ay: number;
  /** 초당 감속 계수(0이면 없음). 속도에 e^(-drag·t)로 곱한다 */
  drag: number;
  /** 시작·끝 크기. 링·덩어리는 반지름 배율, 점은 반지름, 픽셀은 한 변 */
  size0: number;
  size1: number;
  /** 링·덩어리의 타원 반지름(배율 1 기준) */
  rx: number;
  ry: number;
  alpha0: number;
  alpha1: number;
  /** 링·번개의 선 두께 시작·끝(화면 px) */
  w0: number;
  w1: number;
  color: string;
  /** 번개 중심선 색(없으면 color). 발광 번개는 color로 넓은 테두리, core로 얇은 중심을 그린다 */
  core?: string;
  /** 발광 스프라이트로 그린다(점·덩어리) / 번개는 넓은 테두리를 더한다 */
  glow: boolean;
  lifeMs: number;
  delayMs: number;
  ease: FxEase;
  /** 번개 기본 꼭짓점(x0,y0,x1,y1,…). 그릴 때 40ms마다 다시 꺾는다 */
  points?: number[];
  /** 번개 꺾임 크기(킷 좌표) */
  jag?: number;
  /** 번개 꺾임 씨앗 */
  seed?: number;
  /** 조각(shard) 시작 각도(rad)·초당 회전(rad/s). size는 삼각형 외접 반지름 */
  rot?: number;
  spin?: number;
  /** sheet 전용: 재생할 묶음. x·y는 헤드 중심, size0은 그림 한 변(킷 좌표), lifeMs는 재생 길이, alpha0은 전체 밝기, rot은 기울기 */
  sheet?: FxSheetId;
  /** sheet 전용: 좌우 뒤집기(기본 false) */
  mirror?: boolean;
  /** drop 전용: 늘어짐 시간(초, 기본 0.006). 길이는 크기의 6배까지 */
  streak?: number;
  /** 0~1: 수명의 이 비율까지 alpha0을 유지하고 그 뒤 alpha1로 간다(기본 0 = 사용 안 함) */
  hold?: number;
  /** 합성 방식. 없으면 테마 blend. sheet는 항상 더하기 */
  blend?: FxBlendMode;
  /** drop 전용: 발광 번짐 색(없으면 color) */
  glowColor?: string;
  /** 발광 점·덩어리의 스프라이트 종류(기본 soft) */
  sprite?: 'soft' | 'bokeh';
}

/** 세기 → 배율. 판정·콤보가 null이면 판정 배율은 1 */
export interface FxIntensity {
  size: number;
  count: number;
  alpha: number;
}

/** 패드 헤드의 킷 좌표 기하 */
export interface FxGeo {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** 거리 기준 배율(패드 폭 비례) */
  k: number;
  /** 킷 상자의 아래 끝(킷 좌표). 없으면 760×300 킷으로 본다 */
  floor?: number;
}

/** 위치 찾기 결과의 모양. 패드 3종(테마 이펙트) + 하이웨이 레인·악보 머리(판정 이펙트 전용) */
export type FxShape = PadShape | 'lane' | 'head';

/** 이벤트가 이펙트를 낼 위치. geo의 좌표 공간은 FxCanvas의 space(킷 좌표 / CSS 픽셀)를 따른다 */
export interface FxLocation {
  geo: FxGeo;
  shape: FxShape;
  /** 깨짐 파편 색(하이웨이: 노트 색). 없으면 판정 색 */
  tint?: string;
}

/** 이벤트 → 위치. null이면(화면 밖 노트·레인에 없는 패드·비판정) 이펙트를 내지 않는다 */
export type FxLocate = (event: FxEvent) => FxLocation | null;

/** 판정 이펙트 색 묶음(디자인 토큰 --perfect·--good·--miss, 회색은 헛침) */
export interface JudgeColors {
  perfect: string;
  good: string;
  miss: string;
  stray: string;
}

/** 테마 색 묶음 */
export interface FxPalette {
  main: string;
  sub: string;
  glow: string;
}

/** 이벤트 소스: 콜백을 받아 해제 함수를 돌려준다 */
export type FxSource = (onEvent: (e: FxEvent) => void) => () => void;
