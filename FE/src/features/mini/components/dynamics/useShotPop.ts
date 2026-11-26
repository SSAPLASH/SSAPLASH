// 「강약중강약」 친 순간의 큰 숫자 연출 (설계 MODE-006-minigame-dynamics-ui D11).
// 무대 한가운데에서 숫자가 0부터 친 세기까지 올라간 뒤(0.52초) 그 눈금의 아래 숫자 자리로 날아가 앉는다(0.38초).
// 올라가는 값·크기·진하기·세기 색은 프레임마다 요소에 바로 쓴다(다시 그리지 않는다). 색은 세기를 따른다: 약하면 흰빛, 셀수록 메인 색(CSS가 --pop-v로 섞는다). 다음 타를 치면 앞 연출을 끊고 새로 시작한다.
// 모션 줄이기에서는 하지 않는다 — 친 값은 눈금 아래에 바로 보인다.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { velocityRatio } from '@/features/mini/domain/velocityShot';

/** 0부터 친 세기까지 올라가는 시간 */
export const POP_UP_MS = 520;
/** 눈금 아래 숫자 자리로 날아가는 시간 */
export const POP_FLY_MS = 380;
/** 세기에 따른 크기: 가장 약하면 0.5배, 가장 세면 1.3배 */
const POP_SCALE_MIN = 0.5;
const POP_SCALE_SPAN = 0.8;
/** 세기에 따른 진하기(투명도): 가장 약하면 0.4, 가장 세면 1 */
const POP_OPACITY_MIN = 0.4;
const POP_OPACITY_SPAN = 0.6;

/** 방금 친 한 타. `id`가 바뀌면 새 타다 */
export interface PopShot {
  id: string;
  /** 눈금 차례(0부터). 날아가 앉을 자리를 고른다 */
  index: number;
  value: number;
}

export interface ShotPopView {
  /** 큰 숫자를 그릴 타. 없으면 null */
  pop: PopShot | null;
  /** 큰 숫자 요소에 건다 */
  popRef: RefObject<HTMLSpanElement | null>;
  /** 숫자가 올라가는 동안 참(뒤의 문구와 눈금이 한 걸음 물러난다) */
  rising: boolean;
  /** 큰 숫자가 떠 있어 아래 숫자를 숨길 눈금 차례. 없으면 null */
  waiting: number | null;
  /** 큰 숫자가 방금 앉은 눈금 차례(앉는 모션을 건다). 없으면 null */
  landed: number | null;
}

/**
 * `shot`이 바뀔 때마다 큰 숫자 연출을 한 번 돌린다. 처음 그릴 때 이미 있던 타는 돌리지 않는다.
 * 앉을 자리는 `rootRef` 안의 `[data-pop-dest="차례"]`다
 */
export function useShotPop(shot: PopShot | null, rootRef: RefObject<HTMLElement | null>): ShotPopView {
  const reduced = useReducedMotion();
  const popRef = useRef<HTMLSpanElement | null>(null);
  const id = shot?.id ?? null;
  const [seenId, setSeenId] = useState(id);
  const [pop, setPop] = useState<PopShot | null>(null);
  const [rising, setRising] = useState(false);
  const [landed, setLanded] = useState<number | null>(null);

  // 새 타가 들어오면 앞 연출을 버리고 새로 시작한다(그리는 중에 상태를 맞춘다)
  if (id !== seenId) {
    setSeenId(id);
    setPop(shot !== null && !reduced ? shot : null);
    setRising(shot !== null && !reduced);
    setLanded(null);
  }

  useEffect(() => {
    if (pop === null) return;
    const el = popRef.current;
    if (!el) return;
    let alive = true;
    let frame = 0;
    let fly: Animation | undefined;
    let scale = POP_SCALE_MIN;
    const startedAt = performance.now();
    const land = () => {
      if (!alive) return;
      setPop(null);
      setRising(false);
      setLanded(pop.index);
    };
    const up = (now: number) => {
      if (!alive) return;
      const k = Math.min(1, Math.max(0, (now - startedAt) / POP_UP_MS));
      const value = Math.round(pop.value * (1 - (1 - k) ** 3));
      const ratio = velocityRatio(value);
      scale = POP_SCALE_MIN + POP_SCALE_SPAN * ratio;
      el.textContent = String(value);
      el.style.transform = `translate(-50%, -50%) scale(${scale})`;
      el.style.opacity = String(POP_OPACITY_MIN + POP_OPACITY_SPAN * ratio);
      el.style.setProperty('--pop-v', String(ratio));
      if (k < 1) {
        frame = requestAnimationFrame(up);
        return;
      }
      // 날아가기: 지금 자리와 앉을 자리의 차이만큼 옮기고, 앉을 글자 크기만큼 줄인다
      const dest = rootRef.current?.querySelector<HTMLElement>(`[data-pop-dest="${pop.index}"]`);
      if (!dest || typeof el.animate !== 'function') {
        land();
        return;
      }
      setRising(false);
      const from = el.getBoundingClientRect();
      const to = dest.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const endScale = from.height > 0 ? (to.height / from.height) * scale : scale;
      fly = el.animate(
        [
          { transform: `translate(-50%, -50%) scale(${scale})`, opacity: el.style.opacity },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${endScale})`, opacity: 1 },
        ],
        { duration: POP_FLY_MS, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' },
      );
      fly.onfinish = land;
    };
    frame = requestAnimationFrame(up);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      // 큰 숫자 요소는 타마다 새로 그려지므로(key) 날아가던 모션은 요소와 함께 사라진다. 끝남 알림만 끊는다
      if (fly) fly.onfinish = null;
    };
  }, [pop, rootRef]);

  return { pop, popRef, rising, waiting: pop?.index ?? null, landed };
}
