// 「악보 보고 빨리 치기」 진행 점. 문제마다 점 하나: 맞힘(흰색)·틀림 또는 시간 초과(빨강)·지금(속 빈 고리)·남음(흐림).
import type { SightAnswer } from '@/features/mini/domain/sightRound';
import './sight.css';

interface Props {
  /** 한 판의 문제 수 */
  total: number;
  /** 끝난 문제(낸 순서) */
  answers: readonly Pick<SightAnswer, 'wrongs' | 'timedOut'>[];
}

type DotState = 'ok' | 'bad' | 'now' | 'rest';

function dotState(index: number, answers: Props['answers']): DotState {
  if (index < answers.length) {
    const answer = answers[index];
    return answer.wrongs > 0 || answer.timedOut ? 'bad' : 'ok';
  }
  return index === answers.length ? 'now' : 'rest';
}

export function ProblemDots({ total, answers }: Props) {
  return (
    <div className="mini-sight-progress">
      <ol className="mini-sight-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const state = dotState(i, answers);
          return <li key={i} className={`mini-sight-dot is-${state}`} data-state={state} />;
        })}
      </ol>
      <span className="mini-sight-count" data-testid="mini-sight-count">
        {Math.min(answers.length + 1, total)} / {total}
      </span>
    </div>
  );
}
