// 「어디까지 올라가는 거예요?」의 세로 눈금 (설계 MODE-006-minigame-crescendo-ui). 값만 받는다.
// 글래스 캡슐 안에 마지막 계단까지 빛이 차 있고(채움), 받은 계단마다 가로선이 남는다. 직전보다 세지 못해 끝났으면 끝낸 타격의 선을 빨갛게 긋는다.
// 계단을 오른 순간 맨 위 선에서 빛이 옆으로 한 번 퍼지고(울림), 그 옆에 오른 만큼이 「+n」으로 뜬다. 둘 다 계단마다 새 요소가 되어 모션이 다시 재생된다.
// 색은 여기서 정하지 않는다 — 무대(.mini-cres-stage)가 단 높이 값으로 CSS가 고른다.
import type { CrescendoRun } from '@/features/mini/domain/crescendoRound';
import { velocityRatio, VELOCITY_MAX, VELOCITY_MIN } from '@/features/mini/domain/velocityShot';
import './crescendo.css';

interface Props {
  run: CrescendoRun;
}

export function StepLadder({ run }: Props) {
  const { steps } = run;
  const count = steps.length;
  const lastStep = count > 0 ? steps[count - 1] : null;
  const topAt = lastStep !== null ? `${velocityRatio(lastStep) * 100}%` : null;
  const fell = run.end === 'fell';
  // 오른 만큼: 마지막 계단 − 그 앞 계단. 둘째 계단부터 있다
  const gain = count > 1 ? steps[count - 1] - steps[count - 2] : null;

  return (
    <div className="mini-cres-ladder" data-testid="mini-cres-ladder">
      <div className="mini-cres-scale" aria-hidden="true">
        <div className="mini-cres-track">
          {topAt !== null ? <div className="mini-cres-fill" style={{ height: topAt }} data-testid="mini-cres-fill" /> : null}
          {steps.map((value, i) => (
            <div
              key={i}
              className={i === count - 1 ? 'mini-cres-step is-top' : 'mini-cres-step'}
              style={{ bottom: `${velocityRatio(value) * 100}%` }}
              data-testid={`mini-cres-step-${i}`}
            />
          ))}
          {fell && run.last !== null ? (
            <div className="mini-cres-fall" style={{ bottom: `${velocityRatio(run.last) * 100}%` }} data-testid="mini-cres-fall" />
          ) : null}
        </div>
        {topAt !== null && !fell ? (
          <span
            key={`pulse-${count}`}
            className={run.end === 'top' ? 'mini-cres-pulse is-top' : 'mini-cres-pulse'}
            style={{ bottom: topAt }}
            data-testid="mini-cres-pulse"
          />
        ) : null}
        {topAt !== null && gain !== null ? (
          <span key={`gain-${count}`} className="mini-cres-gain" style={{ bottom: topAt }} data-testid="mini-cres-gain">
            +{gain}
          </span>
        ) : null}
        <span className="mini-cres-tick is-max">{VELOCITY_MAX}</span>
        <span className="mini-cres-tick is-min">{VELOCITY_MIN}</span>
      </div>
    </div>
  );
}
