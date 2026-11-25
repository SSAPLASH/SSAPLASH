// 「어디까지 올라가는 거예요?」 플레이 화면 (설계 MODE-006-minigame-crescendo 4절 「플레이 화면」). 값만 받는다 — 타격 구독·타이머는 페이지가 한다.
// 머리에 「직전 계단보다 세게」 문구, 가운데에 지금까지 횟수 · 세로 눈금 · 방금 친 세기 세 칸을 둔다.
// 카운트다운은 본문 영역(position: relative)에 겹쳐 그린다.
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import { StepLadder } from '@/features/mini/components/crescendo/StepLadder';
import { runHint, runPrompt, runScore, type CrescendoRun } from '@/features/mini/domain/crescendoRound';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import './crescendo.css';

interface Props {
  /** countdown · playing · closing 에서 그린다 */
  phase: MiniPhase;
  /** 카운트다운 숫자(3·2·1). 카운트다운 단계가 아니면 null */
  countdown: number | null;
  /** 지금까지의 판 */
  run: CrescendoRun;
  /** 방금 스네어가 아닌 패드를 쳤다(머리 아래 글을 안내로 바꾼다) */
  wrongPad: boolean;
  onQuit: () => void;
}

const WRONG_PAD_HINT = '스네어를 쳐 주세요';

export function CrescendoStage({ phase, countdown, run, wrongPad, onQuit }: Props) {
  const { lead, text } = runPrompt(run);
  const hint = wrongPad ? WRONG_PAD_HINT : runHint(run);
  const lastStep = run.steps.length > 0 ? run.steps[run.steps.length - 1] : null;
  const fell = run.end === 'fell' && run.last !== null;
  const lastValue = fell ? run.last : lastStep;

  return (
    <div className="mini-page mini-stage">
      <div className="mini-stage-top">
        <h2 className="mini-stage-name">어디까지 올라가는 거예요?</h2>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <div className="mini-cres-head">
          <p className="mini-cres-prompt" role="status" data-testid="mini-cres-prompt">
            {lead !== null ? <span className="mini-cres-prompt-num">{lead}</span> : null}
            {text}
          </p>
          {hint !== '' ? (
            <p className={wrongPad ? 'mini-cres-sub is-hint' : 'mini-cres-sub'} role={wrongPad ? 'status' : undefined}>
              {hint}
            </p>
          ) : null}
        </div>

        <div className="mini-cres-board">
          <div className="mini-cres-big is-count">
            <span className="mini-cres-big-label">지금까지</span>
            <span className="mini-cres-big-line">
              <span className="mini-cres-big-value" data-testid="mini-cres-count" aria-live="polite">
                {runScore(run)}
              </span>
              <span className="mini-cres-big-unit">번</span>
            </span>
          </div>
          <StepLadder run={run} />
          <div className="mini-cres-big is-last">
            <span className="mini-cres-big-label">방금 친 세기</span>
            <span className="mini-cres-big-line">
              <span className={fell ? 'mini-cres-big-value is-warn' : 'mini-cres-big-value'} data-testid="mini-cres-last">
                {lastValue ?? '—'}
              </span>
            </span>
          </div>
        </div>

        <p className="mini-cres-note">세기는 1~127로 잽니다. 스네어를 친 것만 받아요.</p>

        {phase === 'countdown' && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
      </div>
    </div>
  );
}
