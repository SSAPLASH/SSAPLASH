// 장면 요소의 스크롤 진행도(0~1). 시안 progress와 같다: 장면 맨 위가 화면 맨 위에 닿을 때 0, 붙어 있는 구간이 끝날 때 1.
import { useScroll, type MotionValue } from 'motion/react';
import type { RefObject } from 'react';

export function useSceneProgress(ref: RefObject<HTMLElement | null>): MotionValue<number> {
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  return scrollYProgress;
}
