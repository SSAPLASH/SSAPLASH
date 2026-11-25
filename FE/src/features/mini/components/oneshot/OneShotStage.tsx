// 「정적 뒤 한 방」 플레이 화면. 값만 받는다 — 음원 재생·타격 구독·타이머는 페이지가 한다.
// 정적 동안에는 박을 짐작할 단서(박 표시)를 일절 보이지 않는다. 카운트다운은 본문 영역(position: relative)에 겹쳐 그린다.
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import { shotStageText, type ShotOutcome, type ShotStep } from '@/features/mini/domain/oneShotRound';
import type { OneShotSong } from '@/features/mini/domain/oneShotSongs';
import { BackingStrip } from './BackingStrip';
import { OneShotSongPick } from './OneShotSongPick';
import './oneshot.css';

interface Props {
  /** countdown · playing · closing 에서 그린다 */
  phase: MiniPhase;
  /** 카운트다운 숫자(3·2·1). 카운트다운 단계가 아니면 null */
  countdown: number | null;
  songs: readonly Pick<OneShotSong, 'id' | 'name' | 'artist'>[];
  songId: string;
  step: ShotStep;
  /** 「지금 위치」 선의 움직임. 없으면 선을 그리지 않는다 */
  sweep: { delayMs: number; durationMs: number } | null;
  /** 판정. 아직 없으면 null */
  outcome: ShotOutcome | null;
  onQuit: () => void;
}

export function OneShotStage({ phase, countdown, songs, songId, step, sweep, outcome, onQuit }: Props) {
  const text = outcome !== null ? shotStageText(outcome) : null;
  const tone = outcome === null ? 'plain' : outcome.kind === 'success' ? 'good' : 'bad';

  return (
    <div className="mini-page mini-stage">
      <div className="mini-stage-top">
        <h2 className="mini-stage-name">정적 뒤 한 방</h2>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <div className="mini-oneshot-main">
          <OneShotSongPick songs={songs} value={songId} locked />
          <p className={`mini-oneshot-headline is-${tone}`} role="status" data-testid="mini-oneshot-headline">
            {text !== null ? (
              text.value
            ) : step === 'rest' ? (
              <>
                <span>딱 한 번</span>
                <span>치세요</span>
              </>
            ) : (
              <>
                <span>잘 듣고</span>
                <span>기다리세요</span>
              </>
            )}
          </p>
          {text !== null && text.caption !== '' ? (
            <p className="mini-oneshot-verdict" data-testid="mini-oneshot-verdict">
              {text.caption}
            </p>
          ) : null}
          {outcome === null ? <p className="mini-oneshot-desc">노래가 돌아올 자리에 딱 한 번 치세요.</p> : null}
          <div className="mini-oneshot-panel">
            <BackingStrip step={step} sweep={sweep} />
          </div>
          <p className="mini-oneshot-note">정적 동안에는 박자 표시가 나오지 않아요.</p>
        </div>
        {phase === 'countdown' && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
      </div>
    </div>
  );
}
