// 캔버스 판(StagePanel) 안의 떠 있는 요소 배치를 재는 훅(PLAY-004 D10·D11, v0.2).
// 판은 스테이지 행 전체 폭이고 안쪽 여백이 24px이다. 드럼 그림(16:10)은 판 안쪽 가운데에 contain으로 놓이고,
// 정보 카드는 판 안쪽 오른쪽(또는 왼쪽) 아래, 경고 배너는 아래쪽 가운데에 놓인다.
// - 카드: 그림 옆 한쪽 여백이 카드 폭 이상이면(카드 폭+24면 그림과 24px 이상 떨어진다) 그림 옆에 놓여 아무것도 가리지 않는다(region = null). 모자랄 때만 그림과 겹치고,
//   그 교차 영역을 그림 정규 좌표(region)로 돌려준다(pickOverlayCorner가 좌우를 고른다).
// - 배너: 폭은 판의 60% 이내. 카드와 가로로 겹치면 카드 위로 쌓는다(세로 간격 12px) — bannerBottom이 그 아래 offset(px)이다.
// 재지 못하면(jsdom·SSR·ResizeObserver 없음) region은 고정 비율 OVERLAY_REGION, bannerBottom은 기본 여백이다.
// 행의 높이 맞춤(useStageFit)도 여기서 함께 건다: 행 ref 하나로 두 가지를 맡는다.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { OVERLAY_REGION } from '@/domain/kitLayout';
import { useStageFit } from './useStageFit';

/** 판 안쪽 여백(px). setup.css의 .setup-stage-panel padding과 같아야 한다 */
export const PANEL_PAD = 24;
/** 배너를 카드 위로 쌓을 때 세로 간격(px) */
export const STACK_GAP = 12;

export interface OverlayRegion {
  w: number;
  h: number;
}

export interface UseOverlayRegion {
  /** 스테이지 행(판의 바깥, 판과 같은 폭)에 연결 */
  rowRef: (el: HTMLElement | null) => void;
  /** 드럼 그림 틀(16:10)에 연결 */
  figRef: (el: HTMLElement | null) => void;
  /** 정보 카드 요소에 연결(KitInfoFrame cardRef) */
  cardRef: (el: HTMLElement | null) => void;
  /** 경고 배너 감싸개에 연결 */
  bannerRef: (el: HTMLElement | null) => void;
  /** 카드가 그림과 겹치는 정규화 영역. null이면 겹침 없음 */
  region: OverlayRegion | null;
  /** 배너 아래쪽 offset(px). 카드와 가로로 안 겹치면 PANEL_PAD, 겹치면 카드 높이+간격만큼 위 */
  bannerBottom: number;
}

/**
 * 판 안쪽 폭·그림·카드 px 크기로 겹침 영역을 계산한다. 카드는 판 안쪽 모서리(left/right 0, bottom 0)에 붙고 그림은 가운데에 있다.
 * 측정 불가(0 이하)면 undefined, 겹침 없음이면 null, 겹치면 그림 정규 좌표의 영역
 */
export function regionFromSizes(
  inner: { w: number },
  fig: { w: number; h: number },
  card: { w: number; h: number },
): OverlayRegion | null | undefined {
  if (!(inner.w > 0) || !(fig.w > 0) || !(fig.h > 0) || !(card.w > 0) || !(card.h > 0)) return undefined;
  const side = (inner.w - fig.w) / 2;
  // 카드는 안쪽 모서리에 붙으므로 그림 쪽으로 파고드는 폭 = 카드 폭 − 한쪽 여백
  const overlapW = card.w - side;
  if (!(overlapW > 0)) return null;
  return { w: Math.min(1, overlapW / fig.w), h: Math.min(1, card.h / fig.h) };
}

/**
 * 배너 아래쪽 offset(px). 배너·카드는 같은 좌표계(가로 px)의 [left, right]이다.
 * 카드가 없거나 가로로 겹치지 않으면 기본 여백, 겹치면 카드 위로 쌓는다(카드 높이 + 간격 12px)
 */
export function bannerBottomOffset(banner: { left: number; right: number }, card: { left: number; right: number; h: number } | null): number {
  if (!card || !(card.h > 0)) return PANEL_PAD;
  const overlapX = banner.left < card.right && banner.right > card.left;
  return overlapX ? PANEL_PAD + card.h + STACK_GAP : PANEL_PAD;
}

export function useOverlayRegion(): UseOverlayRegion {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [fig, setFig] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [banner, setBanner] = useState<HTMLElement | null>(null);
  const [measured, setMeasured] = useState<OverlayRegion | null | undefined>(undefined);
  const [bottom, setBottom] = useState(PANEL_PAD);

  useStageFit(row);

  // 배너 offset: 카드가 좌우로 옮겨 가도 크기는 같으므로 크기 관찰만으로는 모자라다. 렌더마다 위치를 다시 읽는다
  const measureBanner = useCallback(() => {
    if (!banner) return;
    const b = banner.getBoundingClientRect();
    const c = card?.getBoundingClientRect();
    const next = b.width > 0 && c && c.width > 0 ? bannerBottomOffset({ left: b.left, right: b.right }, { left: c.left, right: c.right, h: c.height }) : PANEL_PAD;
    setBottom((prev) => (prev === next ? prev : next));
  }, [banner, card]);
  useLayoutEffect(measureBanner);

  useEffect(() => {
    if (!row || !fig || !card || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const next = regionFromSizes({ w: row.clientWidth - 2 * PANEL_PAD }, { w: fig.offsetWidth, h: fig.offsetHeight }, { w: card.offsetWidth, h: card.offsetHeight });
      setMeasured((prev) => (prev === next || (prev && next && prev.w === next.w && prev.h === next.h) ? prev : next));
      measureBanner();
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(row);
    ro.observe(fig);
    ro.observe(card);
    if (banner) ro.observe(banner);
    return () => ro.disconnect();
  }, [row, fig, card, banner, measureBanner]);

  // 콜백 ref: 요소가 나타나고 사라질 때(조건부 렌더) 상태가 따라가게 한다
  const rowRef = useCallback((el: HTMLElement | null) => setRow(el), []);
  const figRef = useCallback((el: HTMLElement | null) => setFig(el), []);
  const cardRef = useCallback((el: HTMLElement | null) => setCard(el), []);
  const bannerRef = useCallback((el: HTMLElement | null) => setBanner(el), []);
  // 요소가 없거나 재지 못했으면 고정 비율로 되돌아간다
  return { rowRef, figRef, cardRef, bannerRef, region: row && fig && card && measured !== undefined ? measured : OVERLAY_REGION, bannerBottom: bottom };
}
