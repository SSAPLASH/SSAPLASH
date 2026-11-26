// 「어디까지 올라가는 거예요?」 결과 본문 (설계 MODE-006-minigame-crescendo 4절 「결과 화면」). 값만 받는다.
// 칸 3개(시작 세기·끝 세기·평균 간격)와 계단마다 세로 막대를 세운 「세기 계단」 판. 끝낸 타격이 있으면 끝에 빨간 막대를 하나 더 붙인다.
// 막대마다 그 계단의 눈금 비율(--h)과 순번(--i)을 단다. CSS가 --h로 높이 색(메인 색에서 연보라)을 내고 --i 차례로 자라게 한다(설계 MODE-006-minigame-crescendo-ui).
import type { CSSProperties } from 'react';
import { StatCells, type StatCell } from '@/features/mini/components/StatCells';
import { averageStep, type CrescendoRun } from '@/features/mini/domain/crescendoRound';
import { velocityRatio } from '@/features/mini/domain/velocityShot';
import './crescendo.css';

interface Props {
  run: CrescendoRun;
}

const NONE = '—';

export function CrescendoResult({ run }: Props) {
  const { steps } = run;
  const average = averageStep(run);
  const cells: StatCell[] = [
    { label: '시작 세기', value: steps.length > 0 ? String(steps[0]) : NONE },
    { label: '끝 세기', value: steps.length > 0 ? String(steps[steps.length - 1]) : NONE },
    { label: '평균 간격', value: average !== null ? String(average) : NONE },
  ];

  return (
    <>
      <StatCells cells={cells} />
      <section className="mini-chart-panel mini-cres-result" aria-labelledby="mini-cres-result-title">
        <h3 id="mini-cres-result-title" className="mini-chart-title">
          세기 계단
        </h3>
        <ol className="mini-cres-bars">
          {steps.map((value, i) => (
            <li
              key={i}
              className={i === steps.length - 1 ? 'mini-cres-bar is-top' : 'mini-cres-bar'}
              style={{ '--h': velocityRatio(value) } as CSSProperties}
              data-testid={`mini-cres-bar-${i}`}
            >
              <div className="mini-cres-bar-area" aria-hidden="true">
                <div className="mini-cres-bar-fill" style={{ height: `${velocityRatio(value) * 100}%`, '--i': i } as CSSProperties} />
              </div>
              <span className="mini-cres-bar-index">{i + 1}</span>
              <span className="mini-cres-bar-value">{value}</span>
            </li>
          ))}
          {run.end === 'fell' && run.last !== null ? (
            <li className="mini-cres-bar is-fall" data-testid="mini-cres-bar-fall">
              <div className="mini-cres-bar-area" aria-hidden="true">
                <div className="mini-cres-bar-fill" style={{ height: `${velocityRatio(run.last) * 100}%`, '--i': steps.length } as CSSProperties} />
              </div>
              <span className="mini-cres-bar-index">끝</span>
              <span className="mini-cres-bar-value">{run.last}</span>
            </li>
          ) : null}
        </ol>
      </section>
    </>
  );
}
