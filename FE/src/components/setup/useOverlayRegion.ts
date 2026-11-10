// 정보 카드가 캔버스를 실제로 가리는 영역을 재는 훅(PLAY-004 D10).
// 카드는 캔버스가 아니라 스테이지 행(카드 안쪽 전체 폭)의 오른쪽 아래에 붙는다. 행 폭 − 캔버스 폭 ≥ 카드 폭+24이면 카드가 캔버스 옆
// 빈 자리에 놓여 아무것도 가리지 않는다(2×(카드 폭+24) 미만이면 가운데 캔버스를 그만큼 왼쪽으로 비켜 준다). 모자랄 때만 캔버스와 겹친다.
// 겹치면 그 교차 영역을 캔버스 정규 좌표로 돌려준다.
// 겹침이 없으면 region은 null(항상 right). 재지 못하면(jsdom·SSR·ResizeObserver 없음) 고정 비율 OVERLAY_REGION으로 되돌아간다.
// 행의 높이 맞춤(useStageFit)도 여기서 함께 건다: 행 ref 하나로 두 가지를 맡는다.
import { useCallback, useEffect, useState } from 'react';
import { OVERLAY_REGION } from '@/domain/kitLayout';
import { useStageFit } from './useStageFit';

/** 카드가 캔버스 옆 여백에 놓이려면 카드 폭에 더해 필요한 간격(px, 한쪽) */
const SIDE_GAP = 24;

export interface OverlayRegion {
  w: number;
  h: number;
}

export interface UseOverlayRegion {
  /** 스테이지 행(position: relative, 카드 안쪽 전체 폭)에 연결 */
  rowRef: (el: HTMLElement | null) => void;
  /** 캔버스 틀(.setup-stage)에 연결 */
  frameRef: (el: HTMLElement | null) => void;
  /** 정보 카드 요소에 연결(KitInfoFrame cardRef) */
  cardRef: (el: HTMLElement | null) => void;
  /** 카드가 캔버스와 겹치는 정규화 영역. null이면 겹침 없음 */
  region: OverlayRegion | null;
}

/**
 * 카드가 옆에 놓이는데 가운데 캔버스의 한쪽 여백이 모자랄 때, 행 오른쪽에 더 비워 캔버스를 왼쪽으로 비켜 줄 px.
 * 오른쪽 여백 = (행 − p − 캔버스)/2 + p ≥ 카드 폭 + 24 가 되는 최소 p. 필요 없으면 0
 */
export function shiftForCard(row: { w: number }, canvas: { w: number }, card: { w: number }): number {
  if (row.w - canvas.w < card.w + SIDE_GAP) return 0;
  return Math.max(0, Math.ceil(2 * (card.w + SIDE_GAP) - (row.w - canvas.w)));
}

/**
 * 행·캔버스·카드 px 크기로 겹침 영역을 계산한다. 카드는 행 모서리(left/right 0, bottom 0)에 붙고 캔버스는 행 가운데에 있다.
 * 측정 불가(0 이하)면 undefined, 겹침 없음이면 null, 겹치면 캔버스 정규 좌표의 영역
 */
export function regionFromSizes(
  row: { w: number },
  canvas: { w: number; h: number },
  card: { w: number; h: number },
): OverlayRegion | null | undefined {
  if (!(row.w > 0) || !(canvas.w > 0) || !(canvas.h > 0) || !(card.w > 0) || !(card.h > 0)) return undefined;
  // 캔버스를 비켜 주면(shiftForCard) 한쪽 여백이 아니라 남은 폭 전체가 카드 자리다
  if (row.w - canvas.w >= card.w + SIDE_GAP) return null;
  // 카드는 행 모서리에 붙으므로 캔버스 쪽으로 파고드는 폭 = 카드 폭 − 한쪽 여백
  const overlapW = card.w - (row.w - canvas.w) / 2;
  if (!(overlapW > 0)) return null;
  return { w: Math.min(1, overlapW / canvas.w), h: Math.min(1, card.h / canvas.h) };
}

/** 캔버스를 왼쪽으로 비켜 주는 padding을 행에 넣는다(DOM 직접 조작이라 훅 밖에 둔다) */
function applyShift(row: HTMLElement, px: number): void {
  row.style.paddingRight = `${px}px`;
}

export function useOverlayRegion(): UseOverlayRegion {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [measured, setMeasured] = useState<OverlayRegion | null | undefined>(undefined);

  useStageFit(row);

  useEffect(() => {
    if (!row || !frame || !card || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      // 캔버스는 비켜 주기(padding) 전후로 폭이 같다: 비켜 줄 수 있을 만큼 행이 넓을 때만 padding을 주기 때문이다
      applyShift(row, shiftForCard({ w: row.clientWidth }, { w: frame.offsetWidth }, { w: card.offsetWidth }));
      const next = regionFromSizes({ w: row.clientWidth }, { w: frame.offsetWidth, h: frame.offsetHeight }, { w: card.offsetWidth, h: card.offsetHeight });
      setMeasured((prev) => (prev === next || (prev && next && prev.w === next.w && prev.h === next.h) ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(row);
    ro.observe(frame);
    ro.observe(card);
    return () => ro.disconnect();
  }, [row, frame, card]);

  // 콜백 ref: 요소가 나타나고 사라질 때(조건부 렌더) 상태가 따라가게 한다
  const rowRef = useCallback((el: HTMLElement | null) => setRow(el), []);
  const frameRef = useCallback((el: HTMLElement | null) => setFrame(el), []);
  const cardRef = useCallback((el: HTMLElement | null) => setCard(el), []);
  // 요소가 없거나 재지 못했으면 고정 비율로 되돌아간다
  return { rowRef, frameRef, cardRef, region: row && frame && card && measured !== undefined ? measured : OVERLAY_REGION };
}
