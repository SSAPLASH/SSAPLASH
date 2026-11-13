// 스네어 재정렬 프롬프트(PLAY-004 D11). 세팅 ② 카드·시작 확인 창 기기 준비 행·곡 연주 복귀 카드·자유 연습 띠가 같은 조각을 쓴다.
// 손 점(L·R)은 완료한 손만 초록, 문구는 대상 손 수에 따라 바뀌고, [건너뛰기]는 항상 있다(동글 재장착처럼 방향이 안 바뀐 경우).
import type { StickId } from '@/domain/events';
import { Button } from '@/components/ui/action/Button';
import { realignPromptText } from './calibrationText';
import './calibration.css';

export type RealignVariant = 'card' | 'row' | 'band';

/** 진입점이 프롬프트에 넘기는 재정렬 상태 한 덩어리(useRealign이 만든다) */
export interface RealignInfo {
  /** 재정렬 대상 손 */
  hands: readonly StickId[];
  /** 손별 완료 여부 */
  done: readonly [boolean, boolean];
  /** 자동 보정이 방향 흔들림으로 멈춰 걸린 재정렬이면 문구 앞에 이유를 붙인다 */
  unstable?: boolean;
  onSkip: () => void;
}

export interface RealignPromptProps extends RealignInfo {
  variant?: RealignVariant;
}

export function RealignPrompt({ hands, done, unstable, variant = 'card', onSkip }: RealignPromptProps) {
  return (
    <div className={`realign-prompt ${variant}`} role="status" data-testid="realign-prompt">
      <span className="realign-hands" aria-hidden="true">
        {([0, 1] as const).map((h) => {
          const target = hands.includes(h);
          const cls = !target ? 'off' : done[h] ? 'done' : 'wait';
          return (
            <span key={h} className={`realign-hand ${cls}`}>
              {h === 0 ? 'L' : 'R'}
            </span>
          );
        })}
      </span>
      <span className="realign-text">{realignPromptText(hands, done, unstable)}</span>
      <Button variant="text" size="sm" className="realign-skip" onClick={onSkip}>
        건너뛰기
      </Button>
    </div>
  );
}
