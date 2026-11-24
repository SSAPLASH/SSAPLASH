// 「강약중강약」 결과 본문 (Figma 1183:38610). 「타격별 세기」 판: 타마다 목표 띠와 친 세기를 가로 눈금 위에 보인다.
import { bandRange, LEVEL_LABEL, shotRemark, velocityRatio, type DynamicsShot } from '@/features/mini/domain/dynamicsRound';
import './dynamics.css';

interface Props {
  shots: readonly DynamicsShot[];
  /** 차이가 가장 큰 행(0부터). 없으면 강조하지 않는다 */
  highlight?: number;
}

export function DynamicsResult({ shots, highlight }: Props) {
  return (
    <section className="mini-chart-panel mini-dyn-result" aria-labelledby="mini-dyn-result-title">
      <h3 id="mini-dyn-result-title" className="mini-chart-title">
        타격별 세기
      </h3>
      <div className="mini-dyn-legend">
        <span className="mini-dyn-legend-item">
          <span className="mini-dyn-legend-band" aria-hidden="true" />
          목표 띠
        </span>
        <span className="mini-dyn-legend-item">
          <span className="mini-dyn-legend-dot" aria-hidden="true" />내 타격
        </span>
      </div>
      <ol className="mini-dyn-rows">
        {shots.map((shot, i) => {
          const { low, high } = bandRange(shot.target);
          const left = velocityRatio(low) * 100;
          const width = (velocityRatio(high) - velocityRatio(low)) * 100;
          return (
            <li key={i} className="mini-dyn-row" data-testid={`mini-dyn-row-${i}`}>
              <span className="mini-dyn-row-label">
                {i + 1}타 · {LEVEL_LABEL[shot.level]}
              </span>
              <div className="mini-dyn-row-scale" aria-hidden="true">
                <div className="mini-dyn-row-band" style={{ left: `${left}%`, width: `${width}%` }} />
                <div className="mini-dyn-row-dot" style={{ left: `${velocityRatio(shot.actual) * 100}%` }} />
              </div>
              <span className="mini-dyn-row-actual">{shot.actual}</span>
              <span className={`mini-dyn-row-meta${i === highlight ? ' is-warn' : ''}`}>
                목표 {shot.target} · {shotRemark(shot.diff, 'short')}
              </span>
              <span className="mini-dyn-row-score">{shot.score}점</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
