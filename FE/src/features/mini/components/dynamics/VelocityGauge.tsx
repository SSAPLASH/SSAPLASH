// 「강약중강약」 한 타의 세로 눈금 카드 (설계 MODE-006-minigame-dynamics-match 4절). 값만 받는다.
// 감 잡기(1단계)에서는 머리 글자와 친 뒤의 내 타격 표시만, 숫자 맞추기(2단계)에서는 목표 숫자·목표 선·내 세기 표시를 더한다.
import { LEVEL_LABEL, labeledMarks, shotRemark, velocityRatio, VELOCITY_MAX, VELOCITY_MIN, type FeelShot } from '@/features/mini/domain/dynamicsRound';

interface Props {
  /** 차례(0부터) */
  index: number;
  /** 눈금 머리 글. 1단계는 「약」·「중」·「강」, 2단계는 「1타」·「2타」·「3타」 */
  title: string;
  /** 2단계의 숫자 목표. 있으면 머리에 숫자를 크게 보이고 눈금에 목표 선을 그린다 */
  target?: number;
  /** 2단계에서 눈금 옆에 그릴 내 세기 표시 */
  marks?: readonly FeelShot[];
  state: 'done' | 'current' | 'next';
  /** 친 값. state가 done일 때만 넘긴다 */
  actual?: number;
  /** 지금 차례에 「지금 칠 차례」 대신 보일 안내 */
  hint?: string;
}

export function VelocityGauge({ index, title, target, marks, state, actual, hint }: Props) {
  const done = state === 'done' && actual !== undefined;
  // 내 세기 값이 서로 붙어 있으면 글자가 겹친다. 떨어진 것만 글자를 단다
  const labeled = marks ? labeledMarks(marks) : [];

  return (
    <li className={`mini-dyn-gauge is-${state}`} data-testid={`mini-dyn-gauge-${index}`} data-state={state}>
      <div className="mini-dyn-gauge-head">
        {target === undefined ? (
          <span className="mini-dyn-gauge-level">{title}</span>
        ) : (
          <>
            <span className="mini-dyn-gauge-turn">{title}</span>
            <span className="mini-dyn-gauge-level" data-testid={`mini-dyn-target-${index}`}>
              {target}
            </span>
          </>
        )}
      </div>

      <div className="mini-dyn-scale" aria-hidden="true">
        <div className="mini-dyn-track">
          {target !== undefined ? <div className="mini-dyn-target-line" style={{ bottom: `${velocityRatio(target) * 100}%` }} /> : null}
          {marks?.map((mark) => (
            <div key={mark.level} className="mini-dyn-mark" style={{ bottom: `${velocityRatio(mark.actual) * 100}%` }}>
              {labeled.includes(mark.level) ? <span className="mini-dyn-mark-text">{LEVEL_LABEL[mark.level]}</span> : null}
            </div>
          ))}
          {done ? <div className="mini-dyn-marker" style={{ bottom: `${velocityRatio(actual) * 100}%` }} /> : null}
        </div>
        <span className="mini-dyn-tick is-max">{VELOCITY_MAX}</span>
        <span className="mini-dyn-tick is-min">{VELOCITY_MIN}</span>
      </div>

      <div className="mini-dyn-gauge-foot">
        {done ? (
          target === undefined ? (
            <div className="mini-dyn-gauge-result">
              <span className="mini-dyn-gauge-actual" data-testid={`mini-dyn-actual-${index}`}>
                {actual}
              </span>
            </div>
          ) : (
            <>
              <div className="mini-dyn-gauge-result">
                <span className="mini-dyn-gauge-actual" data-testid={`mini-dyn-actual-${index}`}>
                  {actual}
                </span>
                <span className="mini-dyn-gauge-target">목표 {target}</span>
              </div>
              <span className="mini-dyn-gauge-remark">{shotRemark(actual - target, 'sentence')}</span>
            </>
          )
        ) : state === 'current' ? (
          <span className={`mini-dyn-gauge-status${hint ? ' is-hint' : ''}`} role="status">
            {hint ?? '지금 칠 차례'}
          </span>
        ) : (
          <span className="mini-dyn-gauge-status">다음</span>
        )}
      </div>
    </li>
  );
}
