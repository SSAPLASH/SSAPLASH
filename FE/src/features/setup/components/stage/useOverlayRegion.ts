// 캔버스 판(StagePanel) 안의 떠 있는 요소 배치를 재는 훅(PLAY-004 D10·D11, v0.3).
// 판은 스테이지 행 전체 폭이고 안쪽 여백이 16px이다. 드럼 그림 영역(.setup-stage-fig)은 판 안쪽 전체를 채우고,
// 정보 카드는 그 오른쪽(또는 왼쪽) 아래, 경고 배너는 아래쪽 가운데에 그림 위로 겹쳐 놓인다.
// - 카드: 항상 그림과 겹친다. 카드가 그림에서 차지하는 영역을 그림 정규 좌표(region)로 돌려주고 pickOverlayCorner가 좌우를 고른다.
//   figSize는 그림 영역 px 크기(원 반지름·정규 좌표를 px로 환산하는 데 필요)다.
// - 배너: 폭은 판의 60% 이내, 아래쪽 가운데. 카드와 가로로 겹치면 먼저 카드 반대쪽으로 비켜 같은 줄에 둔다(간격 12px).
//   비킬 자리도 없을 때만 카드 위로 쌓는다. bannerPos가 그 자리(px)다.
// 재지 못하면(jsdom·SSR·ResizeObserver 없음) region은 고정 비율 OVERLAY_REGION, figSize는 null, bannerPos는 CSS 기본 자리(가운데, 아래 여백)다.
// 행의 높이 맞춤(useStageFit)도 여기서 함께 건다: 행 ref 하나로 두 가지를 맡는다.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { OVERLAY_REGION } from '@/domain/kit/kitLayout';
import { useStageFit } from './useStageFit';

/** 판 안쪽 여백(px). setup.css의 .setup-stage-panel padding과 같아야 한다 */
export const PANEL_PAD = 16;
/** 배너와 카드 사이 간격(px): 옆으로 비킬 때 가로, 위로 쌓을 때 세로 */
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
  /** 카드가 그림과 겹치는 정규화 영역 */
  region: OverlayRegion;
  /** 그림 영역 px 크기. 못 쟀으면 null */
  figSize: { w: number; h: number } | null;
  /** 배너 자리(px, 판 기준). left가 null이면 CSS 기본(가운데) */
  bannerPos: BannerPos;
}

/**
 * 그림 영역·카드 px 크기로 카드가 그림에서 차지하는 영역(그림 정규 좌표, 1 이하)을 계산한다.
 * 카드는 그림 영역(= 판 안쪽) 모서리에 붙으므로 항상 겹친다. 측정 불가(0 이하)면 undefined
 */
export function regionFromSizes(fig: { w: number; h: number }, card: { w: number; h: number }): OverlayRegion | undefined {
  if (!(fig.w > 0) || !(fig.h > 0) || !(card.w > 0) || !(card.h > 0)) return undefined;
  return { w: Math.min(1, card.w / fig.w), h: Math.min(1, card.h / fig.h) };
}

export interface BannerPos {
  /** 판 왼쪽 끝에서 배너 왼쪽까지(px). null이면 가운데 정렬(CSS) */
  left: number | null;
  /** 판 아래쪽 끝에서 배너 아래까지(px) */
  bottom: number;
}

/**
 * 배너 자리. 좌표는 판(테두리 상자) 왼쪽 끝 기준 px다. 카드가 없거나 가운데 자리가 카드와 안 겹치면 가운데·기본 여백.
 * 겹치면 카드 반대쪽으로 비켜 같은 줄에 두고(판 안쪽 여백을 넘지 않는 한), 그럴 자리도 없으면 가운데에서 카드 위로 쌓는다
 */
export function bannerPlacement(panelW: number, bannerW: number, card: { left: number; right: number; h: number } | null): BannerPos {
  const centered = (panelW - bannerW) / 2;
  if (!card || !(card.h > 0)) return { left: centered, bottom: PANEL_PAD };
  const overlap = centered < card.right && centered + bannerW > card.left;
  if (!overlap) return { left: centered, bottom: PANEL_PAD };
  const cardOnRight = card.left + card.right > panelW;
  if (cardOnRight) {
    const maxLeft = card.left - STACK_GAP - bannerW;
    if (maxLeft >= PANEL_PAD) return { left: Math.min(centered, maxLeft), bottom: PANEL_PAD };
  } else {
    const minLeft = card.right + STACK_GAP;
    if (minLeft + bannerW <= panelW - PANEL_PAD) return { left: Math.max(centered, minLeft), bottom: PANEL_PAD };
  }
  return { left: centered, bottom: PANEL_PAD + card.h + STACK_GAP };
}

export function useOverlayRegion(): UseOverlayRegion {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [fig, setFig] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [banner, setBanner] = useState<HTMLElement | null>(null);
  const [measured, setMeasured] = useState<OverlayRegion | undefined>(undefined);
  const [figSize, setFigSize] = useState<{ w: number; h: number } | null>(null);
  const [pos, setPos] = useState<BannerPos>({ left: null, bottom: PANEL_PAD });

  useStageFit(row);

  // 배너 자리: 카드가 좌우로 옮겨 가도 크기는 같으므로 크기 관찰만으로는 모자라다. 렌더마다 위치를 다시 읽는다.
  // 배너 폭은 자기 자리와 상관없이(max-content, 판의 60% 상한) 같으므로 offsetWidth를 그대로 쓴다
  const measureBanner = useCallback(() => {
    if (!banner) return;
    const panel = banner.offsetParent as HTMLElement | null;
    const bw = banner.offsetWidth;
    if (!panel || !(bw > 0)) return;
    const p = panel.getBoundingClientRect();
    const c = card?.getBoundingClientRect();
    const next = bannerPlacement(p.width, bw, c && c.width > 0 ? { left: c.left - p.left, right: c.right - p.left, h: c.height } : null);
    setPos((prev) => (prev.left !== null && Math.abs(prev.left - next.left!) < 0.5 && prev.bottom === next.bottom ? prev : next));
  }, [banner, card]);
  useLayoutEffect(measureBanner);

  useEffect(() => {
    if (!row || !fig || !card || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const fw = fig.offsetWidth;
      const fh = fig.offsetHeight;
      const next = regionFromSizes({ w: fw, h: fh }, { w: card.offsetWidth, h: card.offsetHeight });
      setMeasured((prev) => (prev === next || (prev && next && prev.w === next.w && prev.h === next.h) ? prev : next));
      setFigSize((prev) => (fw > 0 && fh > 0 ? (prev && prev.w === fw && prev.h === fh ? prev : { w: fw, h: fh }) : null));
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
  return { rowRef, figRef, cardRef, bannerRef, region: row && fig && card && measured !== undefined ? measured : OVERLAY_REGION, figSize: fig ? figSize : null, bannerPos: pos };
}
