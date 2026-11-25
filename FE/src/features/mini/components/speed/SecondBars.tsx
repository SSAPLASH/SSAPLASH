// 초별 타수 막대 (Figma 초별 막대 1182:38322 · chart 1182:38547). 플레이 화면의 작은 막대(compact)와 결과의 큰 막대(chart)가 같이 쓴다.
// 막대 높이는 가장 큰 값에 비례하고, 값 0은 4px짜리 납작한 막대다. 그림 전체에 글로 된 설명을 준다.
// 칸 수는 값 개수(제한 시간의 초 수)다. 큰 막대는 왼쪽부터 차례로 자라고(--i), 작은 막대는 지금 흐르는 초만 강조한다.
import type { CSSProperties } from 'react';
import './speed.css';

interface Props {
  /** 1초마다 친 횟수(제한 시간의 초 수만큼) */
  perSecond: readonly number[];
  variant: 'compact' | 'chart';
  /** 강조할 칸 번호(0부터). 큰 막대(chart)에서 가장 빨랐던 초 */
  highlight?: number;
  /** 지금 흐르는 초의 칸 번호(0부터). 작은 막대(compact)에서 플레이 중에만 넘긴다 */
  current?: number;
}

export function SecondBars({ perSecond, variant, highlight, current }: Props) {
  const max = Math.max(0, ...perSecond);
  const label = `1초마다 친 횟수: ${perSecond.join(', ')}`;
  const chart = variant === 'chart';
  // 칸 수는 값 개수다(10초 판 10칸, 5초 판 5칸)
  const cols = { '--cols': perSecond.length } as CSSProperties;

  const bars = (
    <ul className={`mini-bars mini-bars-${variant}`} style={cols} role="img" aria-label={label}>
      {perSecond.map((count, i) => (
        <li key={i} className="mini-bars-col" aria-hidden="true">
          <span className="mini-bars-slot">
            <span
              className={`mini-bar${chart && i === highlight ? ' is-peak' : ''}${!chart && i === current ? ' is-now' : ''}`}
              style={{ '--h': max > 0 ? (count / max) * 100 : 0, '--i': i } as CSSProperties}
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
      <div className="mini-bars-axis" style={cols} aria-hidden="true">
        {perSecond.map((_, i) => (
          <span key={i}>{i + 1}초</span>
        ))}
      </div>
    </figure>
  );
}
