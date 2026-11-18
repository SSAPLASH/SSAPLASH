// 가상 키트 배치. 좌표는 0~1 정규화(화면 비율 무관). 순수 데이터·함수라 단위 테스트 대상.
// 배치는 표시 전용이다(PLAY-004 D2): 판정은 손별 앵커(settingsStore.stickAnchors)가 맡고,
// 보정이 끝나면 앵커에서 유도한 배치가 여기 형식으로 프리셋 layout에 저장된다.
import type { PadId } from './pads';

/**
 * 가상 키트 배치. 좌표는 0~1 정규화(화면 비율 무관).
 * 연주자 시점: 위쪽이 멀고(심벌), 아래쪽이 가깝다(스네어·킥).
 */
export interface PadPlacement {
  x: number;
  y: number;
  /** 반지름 (정규화 단위, 가로 기준). 표시 전용 */
  r: number;
}

export type KitLayout = Record<PadId, PadPlacement>;

/**
 * 시스템 기본 배치(고정값, PLAY-004 후속 T8). 스틱 패드의 x·y는 3D 모델(kitModel.PAD_POINTS)의 타격점을 두 손 가운데에서 본 방향이라,
 * 원근 그림의 자리와 보정 전 기본 판정 자리가 같은 모델에서 나온다(kitModel.test가 두 값이 맞는지 본다). 모델을 바꾸면 이 값도 다시 계산해 넣는다.
 * x·y는 방향이다(kitMapping.screenToPose: x 0.5가 정면, y 0.5가 수평). 원근 보기(kitPerspective)가 이 방향에 패드별 모델 거리를 곱해 3D 자리로 쓴다.
 * 원근 그림에서 패드가 서로 겹치지 않게 실제 드럼 세트처럼 넓게 벌려 놓았다: 스네어가 정면 아래, 하이햇이 왼쪽, 플로어탐이 오른쪽, 심벌이 위.
 * 킥은 세워진 베이스 드럼이라 가운데 가까이, 스네어와 플로어탐 사이로 가운데가 보이는 자리에 둔다. 하이햇 페달은 하이햇 바로 아래다.
 * 보정 전 판정은 3D 모델 기본 앵커(kitModel)가 맡고, 이 배치는 화면 표시에만 쓴다
 */
export const DEFAULT_KIT_LAYOUT: KitLayout = {
  CRASH: { x: 0.256, y: 0.247, r: 0.1 },
  HIHAT: { x: 0.084, y: 0.6, r: 0.085 },
  SNARE: { x: 0.416, y: 0.867, r: 0.095 },
  SMALL_TOM: { x: 0.388, y: 0.479, r: 0.07 },
  MID_TOM: { x: 0.612, y: 0.479, r: 0.07 },
  FLOOR_TOM: { x: 0.926, y: 0.793, r: 0.1 },
  RIDE: { x: 0.8, y: 0.289, r: 0.11 },
  KICK: { x: 0.57, y: 0.9, r: 0.065 },
  HIHAT_PEDAL: { x: 0.095, y: 0.9, r: 0.055 },
};

/** 일부 패드만 있는 배치를 완전한 KitLayout으로 만든다. 없는 패드는 기본 배치 값을 쓴다 */
export function fillLayout(partial: Partial<KitLayout>): KitLayout {
  const out = {} as KitLayout;
  for (const pad of Object.keys(DEFAULT_KIT_LAYOUT) as PadId[]) {
    out[pad] = partial[pad] ?? DEFAULT_KIT_LAYOUT[pad];
  }
  return out;
}

/** 캔버스 높이/너비. 배치 좌표계(KitCanvas 16:10)에서 y 거리를 반지름(가로 기준) 단위로 바꿀 때 쓴다 */
const CANVAS_ASPECT = 10 / 16;

/** 정보 카드가 캔버스 오른쪽 아래에서 차지하는 정규화 영역(PLAY-004 D10: 기본 배치에서 x>0.8, y>0.78은 빈 자리) */
export const OVERLAY_REGION = { w: 0.2, h: 0.22 } as const;

export type OverlayCorner = 'right' | 'left';

/**
 * 정보 카드를 둘 모서리를 고른다. 기본은 오른쪽 아래이고, 주어진 패드 원이 그 영역과 겹치면 왼쪽 아래로 보낸다.
 * 원과 사각형의 겹침은 사각형에서 원 중심에 가장 가까운 점까지의 거리로 판정한다(맞닿기만 하면 겹침이 아니다)
 */
export function overlayCorner(pad: PadPlacement, region: { w: number; h: number } = OVERLAY_REGION): OverlayCorner {
  const left = 1 - region.w;
  const top = 1 - region.h;
  const nearX = Math.min(Math.max(pad.x, left), 1);
  const nearY = Math.min(Math.max(pad.y, top), 1);
  const dx = pad.x - nearX;
  const dy = (pad.y - nearY) * CANVAS_ASPECT;
  return dx * dx + dy * dy < pad.r * pad.r ? 'left' : 'right';
}

/** 겹침 판정에 쓰는 그림 영역 상자(px 비율이면 충분). 기본 16:10 */
export interface FigBox {
  w: number;
  h: number;
}
const DEFAULT_FIG_BOX: FigBox = { w: 16, h: 10 };

/** 그림 크기 기준 길이: 16:10이면 폭, 더 넓으면 높이×1.6. 원근 보기의 초점 거리와 겹침 판정의 원 반지름이 같이 쓴다 */
export function radiusBasisOf(box: FigBox): number {
  return Math.min(box.w, box.h * 1.6);
}

/** 원(정규 좌표, 반지름은 radiusBasisOf(box) 기준)이 사각형 [x0,x1]×[y0,y1]과 겹치는가. 맞닿기만 하면 겹침이 아니다 */
function circleHitsRect(pad: PadPlacement, x0: number, x1: number, y0: number, y1: number, box: FigBox): boolean {
  const dx = (pad.x - Math.min(Math.max(pad.x, x0), x1)) * box.w;
  const dy = (pad.y - Math.min(Math.max(pad.y, y0), y1)) * box.h;
  const r = pad.r * radiusBasisOf(box);
  return dx * dx + dy * dy < r * r;
}

/**
 * 카드가 그림 위에 겹쳐 뜰 때 놓을 모서리를 고른다(PLAY-004 D10·D11 v0.3).
 * region은 카드가 그림에서 차지하는 영역(그림 정규 좌표, 아래 모서리 기준). null이면 카드가 없어 항상 right.
 * box는 그림 영역 상자(px)로, 원 반지름(r × min(w, h×1.6))과 정규 좌표를 px로 환산하는 데 쓴다. 생략하면 16:10.
 * 모든 패드 중 가려지는 수가 적은 모서리를 고르되, focus(지금 칠·선택 패드)를 가리는 모서리는 피한다. 같으면 right
 */
export function pickOverlayCorner(
  layout: Partial<Record<string, PadPlacement>>,
  region: { w: number; h: number } | null,
  focus: readonly string[] = [],
  box: FigBox = DEFAULT_FIG_BOX,
): OverlayCorner {
  if (!region || !(region.w > 0) || !(region.h > 0)) return 'right';
  const pads = Object.entries(layout).filter((e): e is [string, PadPlacement] => e[1] !== undefined);
  const score = (corner: OverlayCorner) => {
    const [x0, x1] = corner === 'right' ? [1 - region.w, 1] : [0, region.w];
    let covered = 0;
    let focusHit = 0;
    for (const [id, pad] of pads) {
      if (!circleHitsRect(pad, x0, x1, 1 - region.h, 1, box)) continue;
      covered += 1;
      if (focus.includes(id)) focusHit += 1;
    }
    return { covered, focusHit };
  };
  const r = score('right');
  const l = score('left');
  if (r.focusHit !== l.focusHit) return r.focusHit < l.focusHit ? 'right' : 'left';
  return l.covered < r.covered ? 'left' : 'right';
}
