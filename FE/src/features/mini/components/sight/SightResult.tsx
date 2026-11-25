// 「악보 보고 빨리 치기」 결과 본문. 「문제별 반응 시간」 판: 문제마다 막대 하나, 틀려서 더해진 시간은 빨간 끝으로 보인다.
import { barParts, barScaleMs, formatSeconds, padName, wrongCount, type SightAnswer } from '@/features/mini/domain/sightRound';
import './sight.css';

interface Props {
  /** 끝난 문제(낸 순서) */
  answers: readonly SightAnswer[];
}

export function SightResult({ answers }: Props) {
  const scale = barScaleMs(answers);
  return (
    <section className="mini-chart-panel mini-sight-result" aria-labelledby="mini-sight-result-title">
      <h3 id="mini-sight-result-title" className="mini-chart-title">
        문제별 반응 시간
      </h3>
      <ol className="mini-sight-rows">
        {answers.map((answer, i) => {
          const { base, penalty } = barParts(answer, scale);
          return (
            <li key={i} className="mini-sight-row" data-testid={`mini-sight-row-${i}`}>
              <span className="mini-sight-row-no">{i + 1}</span>
              <span className="mini-sight-row-pad">{padName(answer.pad)}</span>
              <div className="mini-sight-row-bar" aria-hidden="true">
                <span className="mini-sight-bar-base" style={{ width: `${base * 100}%` }} />
                {penalty > 0 ? <span className="mini-sight-bar-penalty" style={{ width: `${penalty * 100}%` }} /> : null}
              </div>
              <span className={`mini-sight-row-time${answer.timedOut ? ' is-bad' : ''}`}>
                {answer.timedOut ? '시간 초과' : `${formatSeconds(answer.ms)}초`}
              </span>
            </li>
          );
        })}
      </ol>
      {wrongCount(answers) > 0 ? <p className="mini-sight-result-note">빨간 부분은 틀려서 더해진 0.5초예요.</p> : null}
    </section>
  );
}
