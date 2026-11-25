// 문제 시간 숫자. 음표가 뜬 뒤 흐르고(벌점 포함), 확인 중에는 멈춘 값을 보인다. 흐르는 숫자는 읽어 주지 않는다.
import { useEffect, useState } from 'react';
import { formatSeconds, PROBLEM_LIMIT_MS, WRONG_PENALTY_MS } from '@/features/mini/domain/sightRound';
import './sight.css';

interface Props {
  /** 음표가 떠 있고 제시 시각이 잡혔으면 그 시각(performance.now 축). 흐르는 숫자의 기준. 아니면 null */
  shownAt: number | null;
  /** 지금 문제의 틀린 횟수. 한 번에 WRONG_PENALTY_MS를 더한다 */
  wrongs: number;
  /** 멈춘 값(ms). 확인 중일 때 넘긴다. 있으면 흐르지 않고 이 값을 보인다 */
  frozenMs: number | null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

export function SightClock({ shownAt, wrongs, frozenMs }: Props) {
  const reduced = prefersReducedMotion();
  const running = frozenMs === null && shownAt !== null && !reduced;
  // 어느 제시의 값인지(at)를 함께 둬서, 다음 문제의 첫 프레임 전에 앞 값이 비치지 않게 한다
  const [live, setLive] = useState<{ at: number; ms: number } | null>(null);

  useEffect(() => {
    if (!running || shownAt === null) return;
    let frame = 0;
    const tick = () => {
      const ms = Math.min(PROBLEM_LIMIT_MS, performance.now() - shownAt + wrongs * WRONG_PENALTY_MS);
      setLive({ at: shownAt, ms });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, shownAt, wrongs]);

  let text: string;
  let mode: 'frozen' | 'running' | 'idle';
  if (frozenMs !== null) {
    text = formatSeconds(frozenMs);
    mode = 'frozen';
  } else if (shownAt !== null && reduced) {
    text = '–';
    mode = 'idle';
  } else if (shownAt !== null) {
    text = formatSeconds(live !== null && live.at === shownAt ? live.ms : Math.min(PROBLEM_LIMIT_MS, wrongs * WRONG_PENALTY_MS));
    mode = 'running';
  } else {
    text = '0.00';
    mode = 'idle';
  }

  return (
    <p
      className={`mini-sight-clock is-${mode}`}
      role={mode === 'frozen' ? 'status' : undefined}
      aria-hidden={mode === 'frozen' ? undefined : true}
    >
      <span className="mini-sight-clock-value" data-testid="mini-sight-clock">
        {text}
      </span>
      <span className="mini-sight-clock-unit">초</span>
    </p>
  );
}
