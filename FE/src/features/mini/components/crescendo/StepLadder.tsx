// 「어디까지 올라가는 거예요?」의 세로 눈금 (설계 MODE-006-minigame-crescendo 4절 「플레이 화면」). 값만 받는다.
// 받은 계단마다 가로선을 긋고, 진행 중이면 마지막 계단 아래를 어둡게 칠해 「여기보다 위를 쳐야 한다」를 보인다. 직전보다 세지 못해 끝났으면 끝낸 타격의 선을 주의 색으로 긋는다.
import type { CrescendoRun } from '@/features/mini/domain/crescendoRound';
import { velocityRatio, VELOCITY_MAX, VELOCITY_MIN } from '@/features/mini/domain/velocityShot';
import './crescendo.css';

interface Props {
  run: CrescendoRun;
}

export function StepLadder({ run }: Props) {
  const { steps } = run;
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const showFloor = run.end === null && lastStep !== null;

  return (
    <div className="mini-cres-ladder" data-testid="mini-cres-ladder">
      <div className="mini-cres-scale" aria-hidden="true">
        <div className="mini-cres-track">
          {showFloor ? (
            <div className="mini-cres-floor" style={{ height: `${velocityRatio(lastStep) * 100}%` }} data-testid="mini-cres-floor" />
          ) : null}
          {steps.map((value, i) => (
            <div
              key={i}
              className={i === steps.length - 1 ? 'mini-cres-step is-top' : 'mini-cres-step'}
              style={{ bottom: `${velocityRatio(value) * 100}%` }}
              data-testid={`mini-cres-step-${i}`}
            />
          ))}
          {run.end === 'fell' && run.last !== null ? (
            <div className="mini-cres-fall" style={{ bottom: `${velocityRatio(run.last) * 100}%` }} data-testid="mini-cres-fall" />
          ) : null}
        </div>
        <span className="mini-cres-tick is-max">{VELOCITY_MAX}</span>
        <span className="mini-cres-tick is-min">{VELOCITY_MIN}</span>
      </div>
    </div>
  );
}
