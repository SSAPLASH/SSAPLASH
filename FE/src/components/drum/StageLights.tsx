// 자유 연습 무대 조명(MODE-002 D4): 위에서 내려오는 빛줄기(StageBeam)와 킷 아래 바닥 빛(StageFloor).
// 켜짐·꺼짐의 투명도 전환은 CSS가, 연결 순간 깜빡임과 킥 밝아짐은 Web Animations가 한다(상태를 바꾸지 않아 다시 그리지 않는다)
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { useLive } from '@/store/liveStore';
import './StageLights.css';

/** 연결 순간 깜빡임(목업 beam-on, 1.1초). 계단식이라 키프레임마다 steps(1, end) */
const BEAM_ON: Keyframe[] = [
  [0, 0],
  [0.08, 0.9],
  [0.12, 0.15],
  [0.2, 1],
  [0.24, 0.3],
  [0.34, 1],
  [1, 1],
].map(([offset, opacity]) => ({ offset, opacity, easing: 'steps(1, end)' }));
const BEAM_ON_MS = 1100;

/** 킥 밝아짐(목업 floor, 0.5초) */
const FLOOR_KICK: Keyframe[] = [{ filter: 'brightness(2.1)' }, { filter: 'brightness(1)' }];
const FLOOR_KICK_MS = 500;

/** 페이지 전체에 깔리는 빛줄기. on이 false → true로 바뀔 때만 깜빡이며 켜진다(처음부터 켜진 채면 깜빡이지 않는다) */
export function StageBeam({ on }: { on: boolean }) {
  const beamRef = useRef<HTMLDivElement>(null);
  const prevOn = useRef(on);
  const reduced = useReducedMotion();
  useEffect(() => {
    const was = prevOn.current;
    prevOn.current = on;
    const el = beamRef.current;
    if (was || !on || reduced || !el || typeof el.animate !== 'function') return;
    el.animate(BEAM_ON, { duration: BEAM_ON_MS });
  }, [on, reduced]);
  return (
    <div className={`free-lights${on ? ' is-on' : ''}`} aria-hidden="true">
      <div ref={beamRef} className="free-beam" />
    </div>
  );
}

/** 킷 아래 바닥 빛(DrumKit underlay). 킥을 밟을 때마다 한 번 밝아진다 */
export function StageFloor() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    return useLive.subscribe((s, prev) => {
      if (s.hitSeq === prev.hitSeq || s.lastHit?.pad !== 'KICK') return;
      const el = ref.current;
      if (!el || typeof el.animate !== 'function') return;
      // 새 애니메이션이 이전 것을 덮어쓴다(연타 재시작)
      el.animate(FLOOR_KICK, { duration: FLOOR_KICK_MS, easing: 'cubic-bezier(0, 0, 0.58, 1)' });
    });
  }, [reduced]);
  return <div ref={ref} className="free-floor" aria-hidden="true" />;
}
