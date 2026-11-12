// 캔버스 행(스테이지 행)을 화면 높이에 맞추는 훅(PLAY-004 D9). 추정 상수 대신 측정한다.
// 가용 높이 = innerHeight − 행의 문서 기준 top − 하단 고정 바 높이 − 여백. 결과를 행의 CSS 변수 --setup-stage-maxh로 넣으면
// setup.css가 캔버스 폭(= maxh × 1.6)을 정한다. 재지 못하면(jsdom 등) 변수를 건드리지 않아 CSS 폴백이 쓰인다.
import { useEffect } from 'react';

/** 하단 바 위에 남기는 여백(px) */
export const STAGE_BOTTOM_GAP = 16;
/** 하단 고정 바 요소 선택자(SetupPage .setup-bar) */
const BAR_SELECTOR = '.setup-bar';
const STAGE_MAXH_VAR = '--setup-stage-maxh';

/** 가용 높이(px). 입력이 유한한 숫자가 아니거나 0 이하면 null(측정 불가) */
export function stageMaxHeight(innerHeight: number, docTop: number, barHeight: number): number | null {
  const v = innerHeight - docTop - barHeight - STAGE_BOTTOM_GAP;
  return Number.isFinite(v) && innerHeight > 0 && v > 0 ? Math.floor(v) : null;
}

export function useStageFit(row: HTMLElement | null): void {
  useEffect(() => {
    if (!row) return;
    const update = () => {
      const rect = row.getBoundingClientRect();
      // 레이아웃이 없는 환경(jsdom)은 전부 0이라 폭도 0이다
      if (!(rect.width > 0)) return;
      const bar = document.querySelector<HTMLElement>(BAR_SELECTOR);
      const maxh = stageMaxHeight(window.innerHeight, rect.top + window.scrollY, bar?.offsetHeight ?? 0);
      if (maxh === null) row.style.removeProperty(STAGE_MAXH_VAR);
      else row.style.setProperty(STAGE_MAXH_VAR, `${maxh}px`);
    };
    update();
    window.addEventListener('resize', update);
    // 위쪽 레이아웃(타일·복귀 띠·칩 줄바꿈)이 바뀌면 행 top이 움직인다: 페이지 루트와 하단 바를 지켜본다
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      const root = row.closest<HTMLElement>('.setup-page');
      if (root) ro.observe(root);
      const bar = document.querySelector<HTMLElement>(BAR_SELECTOR);
      if (bar) ro.observe(bar);
    }
    return () => {
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [row]);
}
