// 「인간 메트로놈」 플레이 화면. 값만 받는다 — 예비 박 재생·타격 구독·타이머는 페이지가 한다.
// 측정 중에는 박을 짐작할 단서(소리·박 표시·오차)를 일절 보이지 않고 친 횟수만 보인다.
// 모양(설계 MODE-006-minigame-tempo-ui): 상자 없는 무대와 빛줄기, 머리 줄 보조 글, 가운데의 박 원반(글래스 원 안에 빠르기 숫자).
// 예비 박마다 원반에서 고리가 퍼지고, 소리가 꺼지면 색도 꺼졌다가 칠 때마다 진행률(--tempo-p)만큼 메인 색이 다시 들어온다.
// 측정 중에 화면이 움직이는 때는 타격을 센 순간뿐이고(길이가 고정된 흰 고리), 스스로 되풀이하는 모션은 없다.
// 카운트다운은 무대(.mini-stage) 한가운데에 겹쳐 그린다.
import type { CSSProperties } from 'react';
import { StageBeam } from '@/components/drum/StageLights';
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import { COUNT_IN_BEATS, TEMPO_HITS, type TempoStep } from '@/features/mini/domain/tempoRound';
import { CountDots } from './CountDots';
import './tempo.css';

/** 예비 박의 한 마디 박 수. 마디의 첫 박(1·5번째)이 강세 박이다 */
const BAR_BEATS = 4;

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

/** 원반에서 퍼지는 고리. 박·타격마다 key가 바뀌어 새 요소가 되고 모션이 다시 재생된다. 그릴 것이 없으면 null */
function ring(counting: boolean, measuring: boolean, beats: number, hits: number): { key: string; kind: string } | null {
  if (counting) return null;
  if (measuring) {
    if (hits <= 0) return null;
    return { key: `hit-${hits}`, kind: hits >= TEMPO_HITS ? ' is-done' : ' is-hit' };
  }
  if (beats <= 0) return null;
  return { key: `beat-${beats}`, kind: (beats - 1) % BAR_BEATS === 0 ? ' is-accent' : '' };
}

export function TempoStage({ phase, countdown, bpm, step, beats, hits, onQuit }: Props) {
  const counting = phase === 'countdown';
  const measuring = step === 'measure';
  const done = measuring && hits >= TEMPO_HITS;
  const stageStep = counting ? 'idle' : step;
  // 진행률: 측정 중에만 센 타격 수를 따른다. 색이 이 값만큼 들어온다(정확도와 무관하다)
  const progress = measuring ? Math.min(1, Math.max(0, hits / TEMPO_HITS)) : 0;
  const pulse = ring(counting, measuring, beats, hits);

  return (
    <div className="mini-page mini-stage mini-tempo-stage" data-step={stageStep} style={{ '--tempo-p': progress } as CSSProperties}>
      <StageBeam on={!counting} />
      <div className="mini-stage-top">
        <div className="mini-stage-title">
          <h2 className="mini-stage-name">인간 메트로놈</h2>
          <span className="mini-stage-sub" data-testid="mini-tempo-sub">
            예비 박 {COUNT_IN_BEATS}개 · {TEMPO_HITS}타
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <div className="mini-tempo-main" data-testid="mini-tempo-main" data-step={stageStep} data-done={done ? '' : undefined}>
          <span className="mini-pill mini-tempo-tag" data-testid="mini-tempo-tag">
            {measuring ? '소리 꺼짐' : '예비 박'}
          </span>
          <div className="mini-tempo-pulse">
            <span className="mini-tempo-disc" aria-hidden="true" />
            {pulse === null ? null : <span key={pulse.key} className={`mini-tempo-ring${pulse.kind}`} data-testid="mini-tempo-ring" aria-hidden="true" />}
            <p className="mini-tempo-bpm">
              {/* 예비 박마다 key가 바뀌어 짧게 튄다. 측정 중에는 key가 고정이라 박을 짐작할 단서가 없다 */}
              <span className="mini-tempo-bpm-value" data-testid="mini-tempo-bpm" key={measuring ? 'measure' : beats}>
                {bpm}
              </span>
              <span className="mini-tempo-bpm-unit">BPM</span>
            </p>
          </div>
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
      </div>
      {counting && countdown !== null ? <Countdown value={countdown} backdrop="dim" /> : null}
    </div>
  );
}
