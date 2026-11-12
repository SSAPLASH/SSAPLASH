// 곡 선택 안내 시계 (설계 MODE-001-MODE-003-song-picker-guide 2장). rAF로 경과 시간(ms)을 누적하고 일시정지·한 칸 이동을 맡는다.
// 장면 계산은 하지 않는다(domain/guideScript.stateAt). 대상 요소가 화면 밖이거나 탭이 숨겨지면 누적을 멈추고,
// 모션 줄이기(prefers-reduced-motion)이면 첫 칸에 멈춘 채로 시작한다.
// active=false(접이 바가 접힘)면 누적을 멈추고, 다시 true가 되면 멈춘 시각에서 이어 간다.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { holdStartOf, type GuideScript } from '@/features/play/domain/guideScript';

/** 한 프레임에 이만큼보다 크게 흐른 시간은 이만큼으로 본다(탭 복귀·긴 정지 뒤 장면이 튀지 않게) */
const MAX_FRAME_MS = 250;

export interface GuideClock {
  /** 누적 시각(ms). 루프는 stateAt이 접는다 */
  t: number;
  paused: boolean;
  toggle: () => void;
  /** 칸 i의 멈춤 시작으로 옮기고 멈춘다 */
  stepTo: (i: number) => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

export function useGuideClock(script: GuideScript, targetRef: RefObject<Element | null>, active = true): GuideClock {
  const [reduced] = useState(prefersReducedMotion);
  const [t, setT] = useState(() => (reduced ? holdStartOf(script, 0) + 1 : 0));
  const [paused, setPaused] = useState(reduced);
  const [inView, setInView] = useState(true);
  const [docHidden, setDocHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const tRef = useRef(t);

  // 화면 밖이면 정지. IntersectionObserver가 없는 환경은 항상 보이는 것으로 본다
  useEffect(() => {
    const el = targetRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setInView(last.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [targetRef]);

  // 탭이 숨겨지면 정지
  useEffect(() => {
    const onChange = () => setDocHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const running = !paused && inView && !docHidden && active;
  useEffect(() => {
    if (!running) return;
    let last: number | null = null;
    let raf = requestAnimationFrame(function frame(now) {
      if (last !== null) {
        tRef.current += Math.min(MAX_FRAME_MS, Math.max(0, now - last));
        setT(tRef.current);
      }
      last = now;
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const toggle = useCallback(() => setPaused((p) => !p), []);
  const stepTo = useCallback(
    (i: number) => {
      tRef.current = holdStartOf(script, i) + 1;
      setT(tRef.current);
      setPaused(true);
    },
    [script],
  );

  return { t, paused, toggle, stepTo };
}
