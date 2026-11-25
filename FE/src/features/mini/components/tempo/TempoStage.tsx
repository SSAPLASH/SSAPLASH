// 「인간 메트로놈」 플레이 화면. 값만 받는다 — 예비 박 재생·타격 구독·타이머는 페이지가 한다.
// 측정 중에는 박을 짐작할 단서(소리·박 표시·오차)를 일절 보이지 않고 친 횟수만 보인다.
// 카운트다운은 본문 영역(position: relative)에 겹쳐 그린다.
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import { COUNT_IN_BEATS, TEMPO_HITS, type TempoStep } from '@/features/mini/domain/tempoRound';
import { CountDots } from './CountDots';
import './tempo.css';

interface Props {
  /** countdown · playing · closing 에서 그린다 */
  phase: MiniPhase;
  /** 카운트다운 숫자(3·2·1). 카운트다운 단계가 아니면 null */
  countdown: number | null;
  /** 이번 판의 빠르기 */
  bpm: number;
  /** 예비 박이 울리는 중(listen)인지 측정 중(measure)인지 */
  step: TempoStep;
  /** 울린 예비 박 수(0~8) */
  beats: number;
  /** 센 타격 수(0~16) */
  hits: number;
  onQuit: () => void;
}

export function TempoStage({ phase, countdown, bpm, step, beats, hits, onQuit }: Props) {
  const measuring = step === 'measure';

  return (
    <div className="mini-page mini-stage">
      <div className="mini-stage-top">
        <h2 className="mini-stage-name">인간 메트로놈</h2>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <div className="mini-tempo-main">
          <span className="mini-pill mini-tempo-tag" data-testid="mini-tempo-tag">
            {measuring ? '소리 꺼짐' : '예비 박'}
          </span>
          <p className="mini-tempo-bpm">
            {/* 예비 박마다 key가 바뀌어 짧게 튄다. 측정 중에는 key가 고정이라 박을 짐작할 단서가 없다 */}
            <span className="mini-tempo-bpm-value" data-testid="mini-tempo-bpm" key={measuring ? 'measure' : beats}>
              {bpm}
            </span>
            <span className="mini-tempo-bpm-unit">BPM</span>
          </p>
          <p className="mini-tempo-headline" role="status" data-testid="mini-tempo-headline">
            {measuring ? '같은 빠르기로 치세요' : '박을 들어 보세요'}
          </p>
          <p className="mini-tempo-desc">
            {measuring
              ? '예비 박은 끝났어요. 같은 빠르기를 지켜 16번 치세요.'
              : '8박 뒤에 소리가 꺼져요. 그 뒤로 같은 빠르기로 16번 치세요.'}
          </p>
          <div className="mini-tempo-panel">
            {measuring ? (
              <CountDots total={TEMPO_HITS} filled={hits} label="친 횟수" />
            ) : (
              <CountDots total={COUNT_IN_BEATS} filled={beats} label="예비 박" />
            )}
          </div>
        </div>
        {phase === 'countdown' && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
      </div>
    </div>
  );
}
