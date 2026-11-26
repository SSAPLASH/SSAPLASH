// 「악보 보고 빨리 치기」 플레이 화면 (설계 MODE-006-minigame-sight-ui). 값만 받는다 — 타격 구독·타이머는 페이지가 한다.
// 상자 없는 무대다. 음표가 뜨는 자리에 세로 글래스 캡슐(렌즈)을 두고, 문제 상태·속도 단계·알림을 문제 영역의 속성으로 달아 색과 빛을 CSS가 고르게 한다.
// 카운트다운은 무대 바로 아래에 겹쳐 무대 한가운데에 놓인다. 드럼은 보여 주기만 한다(눌러도 입력 없음).
import { LiveDrumKit } from '@/components/drum/LiveDrumKit';
import { StageBeam } from '@/components/drum/StageLights';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { SoloStaff } from '@/components/lesson/PadNotation';
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import { ProblemDots } from '@/features/mini/components/sight/ProblemDots';
import { SightClock } from '@/features/mini/components/sight/SightClock';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import {
  answerGrade,
  averageMs,
  formatSeconds,
  padName,
  sightMessage,
  wrongCount,
  type SightAnswer,
  type SightHint,
  type SightStep,
} from '@/features/mini/domain/sightRound';
import type { PadId } from '@/domain/kit/pads';
import { useSettings } from '@/store/settingsStore';
import '@/components/lesson/lesson.css';
import './sight.css';

interface Props {
  /** countdown · playing · closing 에서 그린다 */
  phase: MiniPhase;
  /** 카운트다운 숫자(3·2·1). 카운트다운 단계가 아니면 null */
  countdown: number | null;
  hint: SightHint;
  /** 한 판의 문제 수 */
  total: number;
  /** 끝난 문제(낸 순서) */
  answers: readonly SightAnswer[];
  step: SightStep;
  /** 지금 문제의 패드(제시 중에 그린다). 문제를 다 냈으면 null */
  pad: PadId | null;
  /** 음표를 그린 프레임의 시각. 없으면 null */
  shownAt: number | null;
  /** 지금 문제의 틀린 횟수 */
  wrongs: number;
  /** 문제 판에 잠깐 보일 알림 */
  notice: 'early' | 'wrong' | null;
  onQuit: () => void;
}

const HINT_NAME: Record<SightHint, string> = { on: '힌트 켬', off: '힌트 끔' };

/** 드럼 그림. 타격 구독을 여기 가둬서 타격 애니메이션이 화면 전체를 다시 그리지 않게 한다 */
function SightKit({ hint, lit }: { hint: SightHint; lit: PadId | undefined }) {
  const kitSkin = useSettings((s) => s.kitSkin);
  const states = usePadStates();
  const hitSeq = usePadHitSeq();
  return (
    <div className="mini-sight-kit" data-skin={kitSkin}>
      <LiveDrumKit fitWidth effects skin={kitSkin} states={states} hitSeq={hitSeq} labels={hint === 'on'} lit={lit} />
    </div>
  );
}

export function SightStage({ phase, countdown, hint, total, answers, step, pad, shownAt, wrongs, notice, onQuit }: Props) {
  const last = answers[answers.length - 1] ?? null;
  const counting = phase === 'countdown';
  const holding = step === 'hold' && last !== null;
  // 카운트다운 중에는 제시·확인 단계의 값이 들어와도 음표와 그에 딸린 표시를 그리지 않는다
  const shownPad: PadId | null = !counting && step === 'shown' ? pad : null;
  const held: SightAnswer | null = !counting && holding ? last : null;
  const notePad: PadId | null = shownPad ?? held?.pad ?? null;
  const message = counting ? { text: '음표가 뜨면 바로 치세요.', tone: 'plain' as const } : sightMessage(step, notice, holding ? last : null);
  const showName = notePad !== null && (holding || hint === 'on');
  const staffLabel = notePad === null ? '빈 오선' : showName ? `${padName(notePad)} 음표` : '음표';
  const lit = hint === 'on' && step === 'shown' && phase === 'playing' && pad !== null ? pad : undefined;

  // 알림 속성은 문구와 같은 때에만 단다(대기 중의 미리 침, 제시 중의 틀림)
  let noticeAttr: 'early' | 'wrong' | undefined;
  if (!counting && !holding) {
    if (step === 'wait' && notice === 'early') noticeAttr = 'early';
    if (step === 'shown' && notice === 'wrong') noticeAttr = 'wrong';
  }
  // 울림 고리: 음표가 뜰 때와 맞힌 순간마다 새 요소로 갈아 끼워 모션을 다시 재생한다. 시간 초과에는 그리지 않는다
  let ring: { key: string; hit: boolean } | null = null;
  if (shownPad !== null) ring = { key: `shown-${answers.length}-${shownPad}`, hit: false };
  else if (held !== null && !held.timedOut) ring = { key: `hit-${answers.length}`, hit: true };
  const totalWrongs = wrongCount(answers) + (step === 'hold' ? 0 : wrongs);

  return (
    <div className="mini-page mini-stage">
      <StageBeam on={!counting} />
      <div className="mini-stage-top">
        <div className="mini-stage-title">
          <h2 className="mini-stage-name">악보 보고 빨리 치기</h2>
          {/* 한 판 중에는 힌트를 바꿀 수 없다. 지금 값만 보여 준다 */}
          <span className="mini-stage-sub" data-testid="mini-sight-sub">
            {HINT_NAME[hint]} · {total}문제
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <ProblemDots total={total} answers={answers} />
        <div className="mini-sight-layout">
          <section
            className="mini-sight-problem"
            data-testid="mini-sight-problem"
            data-step={counting ? 'idle' : step}
            data-grade={held ? answerGrade(held) : undefined}
            data-notice={noticeAttr}
            data-timeout={held?.timedOut ? '' : undefined}
          >
            <p className={`mini-sight-message is-${message.tone}`} role="status" data-testid="mini-sight-message">
              {message.text}
            </p>
            <div className="mini-sight-staff">
              <span className="mini-sight-lens" aria-hidden="true" />
              <SoloStaff pad={notePad} label={staffLabel} />
              {ring ? <span key={ring.key} className={`mini-sight-ring${ring.hit ? ' is-hit' : ''}`} aria-hidden="true" /> : null}
            </div>
            <p className="mini-sight-hint" data-testid="mini-sight-hint">
              {showName && notePad !== null ? padName(notePad) : null}
            </p>
            <div className="mini-sight-clock-wrap">
              <SightClock
                shownAt={phase === 'playing' && step === 'shown' ? shownAt : null}
                wrongs={wrongs}
                frozenMs={holding ? last.ms : null}
              />
              {/* 벌점: 틀릴 때마다 새 요소로 갈아 끼운다. 문구가 이미 읽어 주므로 낭독기에서 숨긴다 */}
              {shownPad !== null && wrongs > 0 ? (
                <span key={wrongs} className="mini-sight-penalty" aria-hidden="true">
                  +0.5
                </span>
              ) : null}
            </div>
          </section>
          <div className="mini-sight-side">
            <SightKit hint={hint} lit={lit} />
          </div>
        </div>
        <dl className="mini-sight-stats">
          <div className="mini-sight-stat">
            <dt>지금까지 평균</dt>
            <dd>
              <strong data-testid="mini-sight-average">{answers.length > 0 ? `${formatSeconds(averageMs(answers))}초` : '–'}</strong>
            </dd>
          </div>
          <div className="mini-sight-stat">
            <dt>틀림</dt>
            <dd>
              <strong data-testid="mini-sight-wrongs">{totalWrongs}</strong>번
            </dd>
          </div>
        </dl>
        <p className="mini-sight-note">틀리면 한 번에 0.5초가 더해져요. 힌트를 켠 기록과 끈 기록은 따로 남아요.</p>
      </div>
      {counting && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
    </div>
  );
}
