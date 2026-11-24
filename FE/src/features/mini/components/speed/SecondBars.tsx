// 초별 타수 막대 (Figma 초별 막대 1182:38322 · chart 1182:38547). 플레이 화면의 작은 막대(compact)와 결과의 큰 막대(chart)가 같이 쓴다.
// 막대 높이는 가장 큰 값에 비례하고, 값 0은 4px짜리 납작한 막대다. 그림 전체에 글로 된 설명을 준다.
import type { CSSProperties } from 'react';

interface Props {
  /** 1초마다 친 횟수(10개) */
  perSecond: readonly number[];
  variant: 'compact' | 'chart';
  /** 강조할 칸 번호(0부터) */
  highlight?: number;
}

export function SecondBars({ perSecond, variant, highlight }: Props) {
  const max = Math.max(0, ...perSecond);
  const label = `1초마다 친 횟수: ${perSecond.join(', ')}`;
  const chart = variant === 'chart';

  const bars = (
    <ul className={`mini-bars mini-bars-${variant}`} role="img" aria-label={label}>
      {perSecond.map((count, i) => (
        <li key={i} className="mini-bars-col" aria-hidden="true">
          <span className="mini-bars-slot">
            <span
              className={`mini-bar${chart && i === highlight ? ' is-peak' : ''}`}
              style={{ '--h': max > 0 ? (count / max) * 100 : 0 } as CSSProperties}
            >
              {chart ? <span className="mini-bar-num">{count}</span> : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );

  if (!chart) return bars;
  return (
    <figure className="mini-chart">
      {bars}
      <div className="mini-bars-axis" aria-hidden="true">
        {perSecond.map((_, i) => (
          <span key={i}>{i + 1}초</span>
        ))}
      </div>
    </figure>
  );
}
