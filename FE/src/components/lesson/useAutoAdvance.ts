// 레슨 통과 뒤 자동 넘김 카운트다운 (설계 SETUP-학습-코스-자동-넘김 3-2·4-4). 결과 화면 띠와 알아보기 완료 팝업이 같이 쓴다.
// 세는 중 → 0이 되면 이동, 또는 세는 중 → 조작·[머무르기]로 멈춤. 멈춘 뒤 다시 세지 않고, 이동은 한 번만 일어난다.
// 어디로 갈지는 모른다 — 받은 onGo만 부른다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_ADVANCE_SECONDS } from '@/domain/play/lesson';

/** 이 요소(안의 요소) 위의 조작은 멈춤으로 보지 않는다 — [지금 가기] 버튼에 붙인다 */
const GO_SELECTOR = '[data-auto-go]';
/** 결과를 보려는 조작. 오면 카운트다운을 멈춘다 */
const STOP_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;

interface Options {
  /** 참인 동안 센다 */
  enabled: boolean;
  seconds?: number;
  /** 0이 되거나 [지금 가기]일 때 한 번만 부른다 */
  onGo: () => void;
}

export function useAutoAdvance({ enabled, seconds = AUTO_ADVANCE_SECONDS, onGo }: Options) {
  const [elapsed, setElapsed] = useState(0);
  const [stopped, setStopped] = useState(false);
  const gone = useRef(false);
  const goRef = useRef(onGo);
  useEffect(() => {
    goRef.current = onGo;
  }, [onGo]);

  const active = enabled && !stopped;

  const goNow = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    setStopped(true);
    goRef.current();
  }, []);
  const stop = useCallback(() => setStopped(true), []);

  useEffect(() => {
    if (!active) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      if (count >= seconds) {
        clearInterval(timer);
        goNow();
      } else {
        setElapsed(count);
      }
    }, 1000);
    const onInteract = (e: Event) => {
      // 누르고 있어 반복되는 키는 조작으로 보지 않는다(레슨을 끝낸 키가 눌린 채일 수 있다)
      if (e instanceof KeyboardEvent && e.repeat) return;
      if (e.target instanceof Element && e.target.closest(GO_SELECTOR)) return;
      setStopped(true);
    };
    for (const type of STOP_EVENTS) document.addEventListener(type, onInteract, { capture: true, passive: true });
    return () => {
      clearInterval(timer);
      for (const type of STOP_EVENTS) document.removeEventListener(type, onInteract, { capture: true });
    };
  }, [active, seconds, goNow]);

  return { remaining: active ? seconds - elapsed : null, stop, goNow };
}
