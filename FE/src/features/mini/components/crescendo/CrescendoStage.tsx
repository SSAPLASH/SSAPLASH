// 「어디까지 올라가는 거예요?」 플레이 화면. 값만 받는다 — 타격 구독·타이머는 페이지가 한다.
// 머리에 「직전 계단보다 세게」 문구, 가운데에 지금까지 횟수 · 세로 눈금 · 방금 친 세기를 둔다.
// 모양(설계 MODE-006-minigame-crescendo-ui): 상자 없는 무대와 빛줄기, 머리 줄 보조 글, 글래스 캡슐 눈금, 굵은 숫자.
// 무대가 높이 값(--cres-heat, 마지막 계단의 눈금 비율)과 끝난 까닭(data-end)을 달고, 색은 CSS가 그 값으로 메인 색에서 연보라까지 고른다.
// 계단을 오를 때마다 횟수와 세기 숫자를 새 요소로 갈아 끼워 내려앉는 모션을 다시 재생한다.
// 카운트다운은 무대(.mini-stage) 한가운데에 겹쳐 그린다.
import type { CSSProperties } from 'react';
import { StageBeam } from '@/components/drum/StageLights';
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import { StepLadder } from '@/features/mini/components/crescendo/StepLadder';
import { runHint, runPrompt, runScore, type CrescendoRun } from '@/features/mini/domain/crescendoRound';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import { velocityRatio } from '@/features/mini/domain/velocityShot';
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

/** 세기 숫자의 클래스. 값이 없으면 흐리게, 계단을 올랐으면 내려앉고, 떨어졌으면 빨갛다 */
function lastClass(empty: boolean, pop: boolean, fell: boolean): string {
  let name = 'mini-cres-big-value';
  if (empty) name += ' is-empty';
  if (pop) name += ' is-pop';
  if (fell) name += ' is-warn';
  return name;
}

export function CrescendoStage({ phase, countdown, run, wrongPad, onQuit }: Props) {
  const counting = phase === 'countdown';
  const { lead, text } = runPrompt(run);
  const hint = wrongPad ? WRONG_PAD_HINT : runHint(run);
  const stepCount = run.steps.length;
  const lastStep = stepCount > 0 ? run.steps[stepCount - 1] : null;
  const fell = run.end === 'fell' && run.last !== null;
  const lastValue = fell ? run.last : lastStep;
  const climbed = stepCount > 0;
  // 높이 값: 마지막 계단의 눈금 비율. 색이 이 값만큼 연보라 쪽으로 간다
  const heat = lastStep !== null ? velocityRatio(lastStep) : 0;

  return (
    <div
      className="mini-page mini-stage mini-cres-stage"
      data-testid="mini-cres-stage"
      data-end={run.end ?? undefined}
      style={{ '--cres-heat': heat } as CSSProperties}
    >
      <StageBeam on={!counting} />
      <div className="mini-stage-top">
        <div className="mini-stage-title">
          <h2 className="mini-stage-name">어디까지 올라가는 거예요?</h2>
          <span className="mini-stage-sub" data-testid="mini-cres-meta">
            스네어 · 같거나 약하면 끝
          </span>
        </div>
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
            <span className="mini-cres-big-line" aria-live="polite">
              <span
                key={stepCount}
                className={climbed ? 'mini-cres-big-value is-pop' : 'mini-cres-big-value'}
                data-testid="mini-cres-count"
              >
                {runScore(run)}
              </span>
              <span className="mini-cres-big-unit">번</span>
            </span>
          </div>
          <StepLadder run={run} />
          <div className="mini-cres-big is-last">
            <span className="mini-cres-big-label">방금 친 세기</span>
            <span className="mini-cres-big-line">
              <span key={stepCount} className={lastClass(lastValue === null, climbed, fell)} data-testid="mini-cres-last">
                {lastValue ?? '—'}
              </span>
            </span>
          </div>
        </div>

        <p className="mini-cres-note">세기는 1~127로 잽니다. 스네어를 친 것만 받아요.</p>
      </div>
      {counting && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
    </div>
  );
}
