// 「강약중강약」 한 타의 세로 눈금 카드. 목표 띠와(친 뒤에는) 친 세기를 눈금 위에 겹쳐 보인다. 값만 받는다.
import { bandRange, LEVEL_LABEL, shotRemark, velocityRatio, VELOCITY_MAX, VELOCITY_MIN, type DynamicsShot, type DynamicsTarget } from '@/features/mini/domain/dynamicsRound';

interface Props {
  /** 차례(0부터) */
  index: number;
  target: DynamicsTarget;
  state: 'done' | 'current' | 'next';
  /** 친 결과. state가 done일 때만 넘긴다 */
  shot?: DynamicsShot;
  /** 지금 차례에 「지금 칠 차례」 대신 보일 안내 */
  hint?: string;
}

export function VelocityGauge({ index, target, state, shot, hint }: Props) {
  const { low, high } = bandRange(target.velocity);
  const bandBottom = velocityRatio(low) * 100;
  const bandHeight = (velocityRatio(high) - velocityRatio(low)) * 100;
  const done = state === 'done' && shot !== undefined;

  return (
    <li className={`mini-dyn-gauge is-${state}`} data-testid={`mini-dyn-gauge-${index}`} data-state={state}>
      <div className="mini-dyn-gauge-head">
        <span className="mini-dyn-gauge-turn">{index + 1}타</span>
        <span className="mini-dyn-gauge-level">{LEVEL_LABEL[target.level]}</span>
      </div>

      <div className="mini-dyn-scale" aria-hidden="true">
        <div className="mini-dyn-track">
          <div className="mini-dyn-band" style={{ bottom: `${bandBottom}%`, height: `${bandHeight}%` }} />
          {done ? <div className="mini-dyn-marker" style={{ bottom: `${velocityRatio(shot.actual) * 100}%` }} /> : null}
        </div>
        <span className="mini-dyn-tick is-max">{VELOCITY_MAX}</span>
        <span className="mini-dyn-tick is-min">{VELOCITY_MIN}</span>
      </div>

      <div className="mini-dyn-gauge-foot">
        {done ? (
          <>
            <div className="mini-dyn-gauge-result">
              <span className="mini-dyn-gauge-actual" data-testid={`mini-dyn-actual-${index}`}>
                {shot.actual}
              </span>
              <span className="mini-dyn-gauge-target">목표 {shot.target}</span>
            </div>
            <span className="mini-dyn-gauge-remark">{shotRemark(shot.diff, 'sentence')}</span>
          </>
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
