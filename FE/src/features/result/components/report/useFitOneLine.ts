// 글자를 한 줄에 맞추는 훅 (설계 COACH-002-coach-summary-emphasis). 코치 총평 헤드라인이 쓴다.
// 요소 폭이 바뀔 때마다 max부터 줄여 한 줄에 들어가는 가장 큰 크기를 고른다. 하한에서도 넘치면 `is-wrapped`를 붙여 단어 단위로 접게 한다.
import { useLayoutEffect, type RefObject } from 'react';
import { fitFontSize } from '@/features/result/domain/reportView';

export interface FitOneLineOptions {
  max: number;
  min: number;
  /** 이 폭(px) 이하 화면에서 쓸 하한 */
  narrowMin: number;
  narrowMaxWidth: number;
}

export function useFitOneLine(ref: RefObject<HTMLElement | null>, text: string, opts: FitOneLineOptions): void {
  const { max, min, narrowMin, narrowMaxWidth } = opts;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const narrow = typeof window.matchMedia === 'function' && window.matchMedia(`(max-width: ${narrowMaxWidth}px)`).matches;
      // 재는 동안은 접지 않는다(scrollWidth가 넘침을 보이게)
      el.classList.remove('is-wrapped');
      const r = fitFontSize(
        (size) => {
          el.style.fontSize = `${size}px`;
          return el.scrollWidth <= el.clientWidth;
        },
        max,
        narrow ? narrowMin : min,
      );
      el.style.fontSize = `${r.size}px`;
      el.classList.toggle('is-wrapped', !r.fits);
    };
    fit();
    // 웹 글꼴이 늦게 오면 글자 폭이 바뀌므로 다시 잰다
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) fit();
    });
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        alive = false;
      };
    }
    // 높이 변화(접힘)로는 다시 재지 않는다 — 폭이 바뀔 때만
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      fit();
    });
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [ref, text, max, min, narrowMin, narrowMaxWidth]);
}
