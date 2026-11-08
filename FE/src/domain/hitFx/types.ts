// 타격 이펙트 공용 타입 — 이벤트(FxEvent)·테마 id·파티클·강도. 그리기·상태는 여기 없다.
import type { PadId } from '@/domain/pads';
import type { Judgement } from '@/domain/judgement';

/** 이펙트가 나오는 화면. 1단계에서는 미리보기·랩의 크기 조정에만 쓴다 */
export type FxMode = 'free' | 'game' | 'sheet' | 'lab' | 'preview';

/** 타격 한 번의 이펙트 입력. 판정·빠름/느림·콤보는 2·3단계가 채운다(1단계는 항상 null) */
export interface FxEvent {
  /** 타격마다 유일(liveStore hitSeq, 랩·미리보기는 자체 증가). 결정적 난수 씨앗 */
  seq: number;
  /** 표시 패드(visualPadOf 적용 후) */
  pad: PadId;
  /** 세기 0~127 */
  velocity: number;
  mode: FxMode;
  judgement: Judgement | null;
  deltaMs: number | null;
  combo: number | null;
}

/** 테마 id 전체(랩 6종). 설정에 노출하는 출시 목록은 themes.ts의 HIT_FX_THEMES */
export type HitFxTheme = 'auto' | 'electric' | 'water' | 'fire' | 'ink' | 'pixel';

/** 엔진이 그리는 기본 도형 5종 */
export type FxKind = 'ring' | 'dot' | 'bolt' | 'blob' | 'pixel';

export type FxEase = 'out' | 'linear' | 'step12';

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
}

/** 테마 색 묶음 */
export interface FxPalette {
  main: string;
  sub: string;
  glow: string;
}

/** 이벤트 소스: 콜백을 받아 해제 함수를 돌려준다 */
export type FxSource = (onEvent: (e: FxEvent) => void) => () => void;
