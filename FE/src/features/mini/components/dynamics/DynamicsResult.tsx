// 「강약중강약」 결과 본문 (설계 MODE-006-minigame-dynamics-match 4절 「결과 화면」). 예전 시안(Figma 1183:38610)을 고쳐 쓴 것이다.
// 「타격별 세기」 판: 위에 내 세기 줄, 타마다 목표 선·내 세기 표시·친 세기를 가로 눈금 위에 보인다.
import { FeelStrip } from '@/features/mini/components/dynamics/FeelStrip';
import { shotRemark, velocityRatio, type FeelShot, type MatchShot } from '@/features/mini/domain/dynamicsRound';
import './dynamics.css';

interface Props {
  feel: readonly FeelShot[];
  shots: readonly MatchShot[];
  /** 차이가 가장 큰 행(0부터). 없으면 강조하지 않는다 */
  highlight?: number;
}

export function DynamicsResult({ feel, shots, highlight }: Props) {
  return (
    <section className="mini-chart-panel mini-dyn-result" aria-labelledby="mini-dyn-result-title">
      <h3 id="mini-dyn-result-title" className="mini-chart-title">
        타격별 세기
      </h3>
      <FeelStrip feel={feel} />
      <div className="mini-dyn-legend">
        <span className="mini-dyn-legend-item">
          <span className="mini-dyn-legend-line" aria-hidden="true" />
          목표
        </span>
        <span className="mini-dyn-legend-item">
          <span className="mini-dyn-legend-dot" aria-hidden="true" />내 타격
        </span>
        <span className="mini-dyn-legend-item">
          <span className="mini-dyn-legend-mark" aria-hidden="true" />내 세기
        </span>
      </div>
      <ol className="mini-dyn-rows">
        {shots.map((shot, i) => (
          <li key={i} className="mini-dyn-row" data-testid={`mini-dyn-row-${i}`}>
            <span className="mini-dyn-row-label">{i + 1}타</span>
            <div className="mini-dyn-row-scale" aria-hidden="true">
              <div className="mini-dyn-row-target" style={{ left: `${velocityRatio(shot.target) * 100}%` }} />
              {feel.map((mark) => (
                <div key={mark.level} className="mini-dyn-row-mark" style={{ left: `${velocityRatio(mark.actual) * 100}%` }} />
              ))}
              <div className="mini-dyn-row-dot" style={{ left: `${velocityRatio(shot.actual) * 100}%` }} />
            </div>
            <span className="mini-dyn-row-actual">{shot.actual}</span>
            <span className={`mini-dyn-row-meta${i === highlight ? ' is-warn' : ''}`}>
              목표 {shot.target} · {shotRemark(shot.diff, 'short')}
            </span>
            <span className="mini-dyn-row-score">{`오차 ${Math.abs(shot.diff)}`}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
