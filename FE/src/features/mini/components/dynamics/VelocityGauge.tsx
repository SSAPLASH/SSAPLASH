// 「강약중강약」 한 타의 세로 눈금 카드 (설계 MODE-006-minigame-dynamics-match 4절). 값만 받는다.
// 감 잡기(1단계)에서는 머리 글자와 친 뒤의 내 타격 표시만, 숫자 맞추기(2단계)에서는 목표 숫자·목표 선·내 세기 표시를 더한다.
// 모양(설계 MODE-006-minigame-dynamics-ui): 트랙은 글래스 캡슐이고 친 세기까지 채움이 차오른다. 트랙 밖으로 나가는 선(목표·내 세기·내 타격)은 눈금 영역에 겹친 층에 둔다.
// 숫자 맞추기에서 친 타에는 정확도 단계(data-grade)를 달아 색을 CSS가 고르게 한다. 감 잡기의 타에는 목표가 없어 단계가 없고,
// 대신 세기 색(data-tone="strength", --dyn-v)을 쓴다: 약하면 흰빛, 셀수록 메인 색.
import type { CSSProperties } from 'react';
import { LEVEL_LABEL, labeledMarks, shotGrade, shotRemark, type FeelShot } from '@/features/mini/domain/dynamicsRound';
import { velocityRatio, VELOCITY_MAX, VELOCITY_MIN } from '@/features/mini/domain/velocityShot';

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
  /** 친 순간의 큰 숫자 연출: `waiting`이면 큰 숫자가 떠 있어 아래 숫자를 숨기고, `landed`면 방금 앉아 앉는 모션을 건다 */
  pop?: 'waiting' | 'landed';
}

export function VelocityGauge({ index, title, target, marks, state, actual, hint, pop }: Props) {
  const done = state === 'done' && actual !== undefined;
  const grade = done && target !== undefined ? shotGrade(actual - target) : undefined;
  // 감 잡기에서 친 타: 세기 비율을 CSS에 넘겨 색을 섞게 한다
  const strength = done && target === undefined;
  const actualClass = `mini-dyn-gauge-actual${pop ? ` is-${pop}` : ''}`;
  // 내 세기 값이 서로 붙어 있으면 글자가 겹친다. 떨어진 것만 글자를 단다
  const labeled = marks ? labeledMarks(marks) : [];

  return (
    <li
      className={`mini-dyn-gauge is-${state}`}
      data-testid={`mini-dyn-gauge-${index}`} data-state={state}
      data-grade={grade}
      data-tone={strength ? 'strength' : undefined}
      style={strength ? ({ '--dyn-v': velocityRatio(actual) } as CSSProperties) : undefined}
    >
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
          {done ? <div className="mini-dyn-fill" style={{ height: `${velocityRatio(actual) * 100}%` }} /> : null}
        </div>
        <div className="mini-dyn-lines">
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
              <span className={actualClass} data-testid={`mini-dyn-actual-${index}`} data-pop-dest={index}>
                {actual}
              </span>
            </div>
          ) : (
            <>
              <div className="mini-dyn-gauge-result">
                <span className={actualClass} data-testid={`mini-dyn-actual-${index}`} data-pop-dest={index}>
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
