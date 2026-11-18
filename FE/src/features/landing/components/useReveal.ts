// 시안 .reveal: 화면에 들어오면(20% 이상) 아래에서 떠오르며 나타난다. 한 번 나타나면 관찰을 해제한다.
// 마운트 전(서버 렌더·JS 미동작)·모션 줄이기·IntersectionObserver 없음에서는 숨김 클래스를 붙이지 않아 항상 보인다.
import { useReducedMotion } from 'motion/react';
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

export interface Reveal {
  /** 없으면 undefined. 요소 자체 클래스와 합쳐 쓴다(joinClass) */
  className: string | undefined;
  style: CSSProperties | undefined;
}

/** index는 문서 순서(지연 (index % 4) * 80ms). ref는 호출하는 쪽이 만들어 요소에 단다(렌더 중 ref 읽기 경고를 피한다) */
export function useReveal(ref: RefObject<HTMLElement | null>, index: number): Reveal {
  const reduce = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<'idle' | 'hidden' | 'shown'>('idle');

  useEffect(() => {
    const el = ref.current;
    if (reduce || !el || typeof IntersectionObserver === 'undefined') return;
    setPhase((p) => (p === 'shown' ? p : 'hidden'));
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setPhase('shown');
        io.disconnect();
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce, ref]);

  if (reduce || phase === 'idle') return { className: undefined, style: undefined };
  return {
    className: phase === 'shown' ? 'lp-reveal lp-in' : 'lp-reveal',
    style: { transitionDelay: `${(index % 4) * 80}ms` },
  };
}

/** 클래스 이름 이어 붙이기(빈 값 제외) */
export const joinClass = (...names: Array<string | undefined>): string => names.filter(Boolean).join(' ');
