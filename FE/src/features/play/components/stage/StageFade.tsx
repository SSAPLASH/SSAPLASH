// 같은 화면 안 단계 전환 페이드(설계 TECH-route-split-transition 3-1). stageKey가 바뀌면 래퍼가 재마운트되어 .stage-fade가 다시 돈다.
// CSS 페이드만 쓴다(motion 기능 청크를 기다리지 않고, transform이 없어 안쪽 fixed 요소가 어긋나지 않는다).
// 래퍼는 .route-view와 같은 배치(flex 열)를 이어받아 안쪽 .main 레이아웃이 그대로다(motion.css). Suspense 경계는 품지 않는다.
import type { ReactNode } from 'react';

interface Props {
  /** 바뀌면 자식을 재마운트하며 페이드 인 */
  stageKey: string;
  /** 참이면 래퍼 없이 그대로(연출 없음) */
  instant?: boolean;
  children: ReactNode;
}

export function StageFade({ stageKey, instant = false, children }: Props) {
  if (instant) return <>{children}</>;
  return (
    <div key={stageKey} className="stage-fade">
      {children}
    </div>
  );
}
