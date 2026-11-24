// 「강약중강약」 플레이 화면 (Figma 1183:38406). 값만 받는다 — 타격 구독·타이머는 페이지가 한다.
// 카운트다운은 본문 영역(position: relative)에 겹쳐 그린다.
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import { VelocityGauge } from '@/features/mini/components/dynamics/VelocityGauge';
import { levelPrompt, type DynamicsShot, type DynamicsTarget } from '@/features/mini/domain/dynamicsRound';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import './dynamics.css';

interface Props {
  /** countdown · playing · closing 에서 그린다 */
  phase: MiniPhase;
  /** 카운트다운 숫자(3·2·1). 카운트다운 단계가 아니면 null */
  countdown: number | null;
  targets: readonly DynamicsTarget[];
  shots: readonly DynamicsShot[];
  /** 방금 스네어가 아닌 패드를 쳤다(지금 차례 눈금에 안내를 보인다) */
  wrongPad: boolean;
  onQuit: () => void;
}

const ALL_DONE_PROMPT = '세 번 다 쳤어요.';

export function DynamicsStage({ phase, countdown, targets, shots, wrongPad, onQuit }: Props) {
  const closing = phase === 'closing';
  const nextTarget = targets[shots.length];
  const allDone = closing || shots.length >= targets.length || nextTarget === undefined;
  const prompt = allDone ? ALL_DONE_PROMPT : levelPrompt(nextTarget.level);

  return (
    <div className="mini-page mini-stage">
      <div className="mini-stage-top">
        <h2 className="mini-stage-name">강약중강약</h2>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <div className="mini-dyn-head">
          <p className="mini-dyn-prompt" role="status" data-testid="mini-dyn-prompt">
            {targets.length > 0 ? prompt : null}
          </p>
          {targets.length > 0 && prompt !== ALL_DONE_PROMPT ? <p className="mini-dyn-sub">밝은 띠 안에 들어오게 한 번 치세요.</p> : null}
        </div>

        <ol className="mini-dyn-gauges">
          {targets.map((target, i) => {
            const state = i < shots.length ? 'done' : i === shots.length && !closing ? 'current' : 'next';
            return (
              <VelocityGauge
                key={i}
                index={i}
                target={target}
                state={state}
                shot={state === 'done' ? shots[i] : undefined}
                hint={state === 'current' && wrongPad ? '스네어를 쳐 주세요' : undefined}
              />
            );
          })}
        </ol>

        <p className="mini-dyn-note">세기는 1~127로 잽니다. 스네어를 친 것만 받아요.</p>

        {phase === 'countdown' && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
      </div>
    </div>
  );
}
