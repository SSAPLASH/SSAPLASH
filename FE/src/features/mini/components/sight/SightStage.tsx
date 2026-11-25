// 「악보 보고 빨리 치기」 플레이 화면. 값만 받는다 — 타격 구독·타이머는 페이지가 한다.
// 카운트다운은 본문 영역(position: relative)에 겹쳐 그린다. 드럼은 보여 주기만 한다(눌러도 입력 없음).
import { LiveDrumKit } from '@/components/drum/LiveDrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { SoloStaff } from '@/components/lesson/PadNotation';
import { Button } from '@/components/ui/action/Button';
import { Segmented } from '@/components/ui/form/Segmented';
import { Countdown } from '@/components/ui/feedback/Countdown';
import { StatCells } from '@/features/mini/components/StatCells';
import { ProblemDots } from '@/features/mini/components/sight/ProblemDots';
import { SightClock } from '@/features/mini/components/sight/SightClock';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import {
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
  const holding = step === 'hold' && last !== null;
  const counting = phase === 'countdown';
  const notePad: PadId | null = counting ? null : step === 'shown' ? pad : holding ? last.pad : null;
  const message = counting ? { text: '음표가 뜨면 바로 치세요.', tone: 'plain' as const } : sightMessage(step, notice, holding ? last : null);
  const showName = notePad !== null && (holding || hint === 'on');
  const staffLabel = notePad === null ? '빈 오선' : showName ? `${padName(notePad)} 음표` : '음표';
  const lit = hint === 'on' && step === 'shown' && phase === 'playing' && pad !== null ? pad : undefined;

  return (
    <div className="mini-page mini-stage">
      <div className="mini-stage-top">
        <h2 className="mini-stage-name">악보 보고 빨리 치기</h2>
        <div className="mini-sight-top-actions">
          {/* 한 판 중에는 바꿀 수 없다. 지금 값만 보여 준다 */}
          <Segmented
            label="힌트"
            value={hint}
            onChange={() => undefined}
            options={[
              { value: 'on', label: '힌트 켬', disabled: true },
              { value: 'off', label: '힌트 끔', disabled: true },
            ]}
          />
          <Button variant="secondary" size="sm" onClick={onQuit}>
            그만하기
          </Button>
        </div>
      </div>
      <div className="mini-stage-body">
        <ProblemDots total={total} answers={answers} />
        <div className="mini-sight-layout">
          <section className="mini-sight-problem">
            <p className={`mini-sight-message is-${message.tone}`} role="status" data-testid="mini-sight-message">
              {message.text}
            </p>
            <SoloStaff pad={notePad} label={staffLabel} />
            <p className="mini-sight-hint" data-testid="mini-sight-hint">
              {showName && notePad !== null ? padName(notePad) : null}
            </p>
            <SightClock
              shownAt={phase === 'playing' && step === 'shown' ? shownAt : null}
              wrongs={wrongs}
              frozenMs={holding ? last.ms : null}
            />
          </section>
          <div className="mini-sight-side">
            <StatCells
              cells={[
                {
                  label: '지금까지 평균',
                  value: answers.length > 0 ? formatSeconds(averageMs(answers)) : '–',
                  unit: answers.length > 0 ? '초' : undefined,
                  note: `${answers.length}문제`,
                },
                {
                  label: '틀림',
                  // 확인 중에는 끝난 문제에 이미 틀린 횟수가 들어 있다
                  value: String(wrongCount(answers) + (step === 'hold' ? 0 : wrongs)),
                  unit: '번',
                  note: '한 번에 0.5초 더해요',
                },
              ]}
            />
            <div className="mini-sight-kit-panel">
              <SightKit hint={hint} lit={lit} />
              <p className="mini-sight-kit-note">힌트를 켠 기록과 끈 기록은 따로 남아요.</p>
            </div>
          </div>
        </div>
        {counting && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
      </div>
    </div>
  );
}
