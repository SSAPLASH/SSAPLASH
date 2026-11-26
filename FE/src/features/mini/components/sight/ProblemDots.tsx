// 「악보 보고 빨리 치기」 진행 눈금. 문제마다 글래스 캡슐 한 칸: 끝난 칸은 속도 단계 색(data-grade)·지금 칸은 숨 쉬는 네온·남은 칸은 빈 캡슐.
import { answerGrade, type SightAnswer } from '@/features/mini/domain/sightRound';
import './sight.css';

interface Props {
  /** 한 판의 문제 수 */
  total: number;
  /** 끝난 문제(낸 순서) */
  answers: readonly Pick<SightAnswer, 'ms' | 'wrongs' | 'timedOut'>[];
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
          const grade = i < answers.length ? answerGrade(answers[i]) : undefined;
          return <li key={i} className={`mini-sight-dot is-${state}`} data-state={state} data-grade={grade} />;
        })}
      </ol>
      <span className="mini-sight-count" data-testid="mini-sight-count">
        {Math.min(answers.length + 1, total)} / {total}
      </span>
    </div>
  );
}
