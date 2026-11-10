// 센서 스틱 그림의 스윙 rAF 루프. 장면이 화면 안에 있고 enabled일 때만 돌며, 프레임마다 React 상태를 바꾸지 않고 콜백으로 DOM을 직접 갱신한다.
import { useEffect, useRef, type RefObject } from 'react';
import { isStrike, swingAngle, swingSign } from '../../domain/landingMotion';

interface Options {
  /** 화면 안 여부를 지켜볼 스틱 그림 영역 */
  stageRef: RefObject<Element | null>;
  /** false면(모션 줄이기) 루프를 돌리지 않는다 */
  enabled: boolean;
  /** 매 프레임 스틱 각도(deg) */
  onFrame: (angle: number) => void;
  /** 스틱이 내려치는 순간 */
  onStrike: () => void;
}

export function useStickSwing({ stageRef, enabled, onFrame, onStrike }: Options): void {
  // 콜백은 ref로 들고 있어 루프·관찰자를 다시 만들지 않는다
  const handlers = useRef({ onFrame, onStrike });
  useEffect(() => {
    handlers.current = { onFrame, onStrike };
  });

  useEffect(() => {
    const stage = stageRef.current;
    // IntersectionObserver가 없으면 화면 밖 판정을 못 하므로 돌리지 않는다
    if (!enabled || !stage || typeof IntersectionObserver === 'undefined') return;

    let raf = 0;
    let running = false;
    let startedAt = -1;
    let lastSign = 1;

    const tick = (now: number) => {
      if (startedAt < 0) startedAt = now;
      const t = (now - startedAt) / 1000;
      handlers.current.onFrame(swingAngle(t));
      const sign = swingSign(t);
      if (isStrike(lastSign, sign)) handlers.current.onStrike();
      lastSign = sign;
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (running) return;
      running = true;
      startedAt = -1;
      lastSign = 1;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last?.isIntersecting) start();
      else stop();
    });
    io.observe(stage);
    return () => {
      io.disconnect();
      stop();
    };
  }, [enabled, stageRef]);
}
