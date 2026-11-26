// 「강약중강약」 플레이 화면 (설계 MODE-006-minigame-dynamics-match 4절). 예전 시안(Figma 1183:38406)을 고쳐 쓴 것이다. 값만 받는다 — 타격 구독·타이머는 페이지가 한다.
// 한 판은 두 단계다. 감 잡기·내 세기 보이기에서는 약·중·강 눈금을, 숫자 맞추기에서는 내 세기 줄과 숫자 목표 눈금을 보인다.
// 모양(설계 MODE-006-minigame-dynamics-ui): 상자 없는 무대와 빛줄기, 머리 줄 보조 글, 단계 표시 「1 감 잡기 → 2 숫자 맞추기」.
// 카운트다운과 친 순간의 큰 숫자는 무대(.mini-stage) 한가운데에 겹쳐 그린다.
import { Fragment, useRef, type ReactNode } from 'react';
import { StageBeam } from '@/components/drum/StageLights';
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import { FeelStrip } from '@/features/mini/components/dynamics/FeelStrip';
import { useShotPop, type PopShot } from '@/features/mini/components/dynamics/useShotPop';
import { VelocityGauge } from '@/features/mini/components/dynamics/VelocityGauge';
import {
  FEEL_ORDER,
  LEVEL_LABEL,
  MATCH_PROMPT_TAIL,
  feelPrompt,
  type DynamicsStep,
  type FeelShot,
  type MatchShot,
} from '@/features/mini/domain/dynamicsRound';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import './dynamics.css';

interface Props {
  /** countdown · playing · closing 에서 그린다 */
  phase: MiniPhase;
  /** 카운트다운 숫자(3·2·1). 카운트다운 단계가 아니면 null */
  countdown: number | null;
  /** 게임 안의 단계: 감 잡기 · 내 세기 보이기 · 숫자 맞추기 */
  step: DynamicsStep;
  /** 감 잡기에서 친 타 */
  feel: readonly FeelShot[];
  /** 숫자 맞추기의 목표(그 단계 전에는 빈 배열) */
  targets: readonly number[];
  /** 숫자 맞추기에서 친 타 */
  shots: readonly MatchShot[];
  /** 방금 스네어가 아닌 패드를 쳤다(지금 차례 눈금에 안내를 보인다) */
  wrongPad: boolean;
  onQuit: () => void;
}

const ALL_DONE_PROMPT = '세 번 다 쳤어요.';
const REVIEW_PROMPT = '내 세기를 쟀어요.';
const WRONG_PAD_HINT = '스네어를 쳐 주세요';
const MATCH_TURN_LABEL = ['1타', '2타', '3타'];
/** 단계 표시의 이름. 내 세기 보이기는 감 잡기에 든다 */
const STEP_NAMES = ['감 잡기', '숫자 맞추기'];

export function DynamicsStage({ phase, countdown, step, feel, targets, shots, wrongPad, onQuit }: Props) {
  const closing = phase === 'closing';
  const matching = step === 'match';
  const rootRef = useRef<HTMLDivElement>(null);

  // 방금 친 타: 감 잡기는 마지막 내 세기, 숫자 맞추기는 마지막 타. 큰 숫자 연출이 이 값으로 돈다
  const lastIndex = (matching ? shots.length : feel.length) - 1;
  const lastShot: PopShot | null =
    lastIndex < 0
      ? null
      : {
          id: `${matching ? 'match' : 'feel'}-${lastIndex}`,
          index: lastIndex,
          value: matching ? shots[lastIndex].actual : feel[lastIndex].actual,
        };
  const { pop, popRef, rising, waiting, landed } = useShotPop(lastShot, rootRef);
  const popState = (i: number) => (waiting === i ? 'waiting' : landed === i ? 'landed' : undefined);
  let gauges: ReactNode;
  let prompt: ReactNode;
  let sub: string | null;

  if (!matching) {
    gauges = FEEL_ORDER.map((level, i) => {
      const state = i < feel.length ? 'done' : step === 'feel' && i === feel.length ? 'current' : 'next';
      return (
        <VelocityGauge
          key={level}
          index={i}
          title={LEVEL_LABEL[level]}
          state={state}
          actual={state === 'done' ? feel[i].actual : undefined}
          hint={state === 'current' && wrongPad ? WRONG_PAD_HINT : undefined}
          pop={popState(i)}
        />
      );
    });
    const next = FEEL_ORDER[feel.length];
    prompt = step === 'feel' && next !== undefined ? feelPrompt(next) : REVIEW_PROMPT;
    sub = step === 'feel' ? '점수는 없어요. 내 세기를 먼저 재요.' : '이제 숫자에 맞춰 칩니다.';
  } else {
    gauges = targets.map((target, i) => {
      const state = i < shots.length ? 'done' : !closing && i === shots.length ? 'current' : 'next';
      return (
        <VelocityGauge
          key={i}
          index={i}
          title={MATCH_TURN_LABEL[i] ?? `${i + 1}타`}
          target={target}
          marks={feel}
          state={state}
          actual={state === 'done' ? shots[i].actual : undefined}
          hint={state === 'current' && wrongPad ? WRONG_PAD_HINT : undefined}
          pop={popState(i)}
        />
      );
    });
    const nextTarget = targets[shots.length];
    const allDone = closing || shots.length >= targets.length || nextTarget === undefined;
    if (allDone) {
      prompt = ALL_DONE_PROMPT;
      sub = null;
    } else {
      // 숫자만 크게 그리고 뒤 글을 바로 붙인다. 읽으면 「88에 맞춰 한 번.」이다
      prompt = (
        <>
          <span className="mini-dyn-prompt-num">{nextTarget}</span>
          {MATCH_PROMPT_TAIL}
        </>
      );
      sub = '내 세기를 보고 힘을 가늠하세요.';
    }
  }

  const nowStep = matching ? 1 : 0;

  return (
    <div ref={rootRef} className={`mini-page mini-stage${rising ? ' is-popping' : ''}`}>
      <StageBeam on={phase !== 'countdown'} />
      <div className="mini-stage-top">
        <div className="mini-stage-title">
          <h2 className="mini-stage-name">강약중강약</h2>
          <span className="mini-stage-sub">{STEP_NAMES[nowStep]} · 스네어</span>
        </div>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <ol className="mini-dyn-steps" aria-label="단계">
          {STEP_NAMES.map((name, i) => (
            <Fragment key={name}>
              {i > 0 ? (
                <li className="mini-dyn-step-arrow" aria-hidden="true">
                  →
                </li>
              ) : null}
              <li
                className={`mini-dyn-step${i === nowStep ? ' is-now' : i < nowStep ? ' is-done' : ''}`}
                aria-current={i === nowStep ? 'step' : undefined}
              >
                <i aria-hidden="true">{i + 1}</i>
                {name}
              </li>
            </Fragment>
          ))}
        </ol>

        {matching ? <FeelStrip feel={feel} /> : null}

        <div className="mini-dyn-head">
          <p className="mini-dyn-prompt" role="status" data-testid="mini-dyn-prompt">
            {prompt}
          </p>
          {sub !== null ? <p className="mini-dyn-sub">{sub}</p> : null}
        </div>

        <ol className="mini-dyn-gauges">{gauges}</ol>

        <p className="mini-dyn-note">세기는 1~127로 잽니다. 스네어를 친 것만 받아요.</p>
      </div>

      {pop !== null ? (
        <span key={pop.id} ref={popRef} className="mini-dyn-pop" aria-hidden="true">
          0
        </span>
      ) : null}
      {phase === 'countdown' && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
    </div>
  );
}
