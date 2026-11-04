import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';

// 앱 최상단 모션 공급자. features는 동적 import로 별도 청크에서 불러온다.
// strict: 컴포넌트가 `motion.*`을 쓰면 오류를 낸다 — 반드시 `m.*`만 쓴다.
// reducedMotion="user": OS의 모션 줄이기 설정을 여기서 일괄 존중한다.
export default function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={() => import('./motionFeatures').then((mod) => mod.default)} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: 'easeOut' }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
