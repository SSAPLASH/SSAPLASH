// Figma Setup / StatusTile 505:2449 — 드럼 세팅 상단 2열 상태 타일(스틱 연결·시작 위치 보정). 요약만 보여 주는 버튼이고(호버·누름 울림은 StrikeButton), 누르면 단계 팝업(StepDialog)이 열린다(PLAY-004 D8).
// on=초록(연결됨·보정됨), urgent=빨강(복귀 띠가 떠 있는 필요 단계), attention=강조(모자란 단계), off=회색. 상태 판정은 하지 않는다(호출자가 정한다).
import type { SetupStepStatus } from '@/domain/kit/calibration/setupSteps';
import { StrikeButton } from './StrikeButton';
import './setup.css';

interface Props {
  /** 타일 DOM id */
  id: string;
  title: string;
  status: SetupStepStatus;
  /** 상태 한 단어(「연결됨」「보정 필요」 …) */
  statusText: string;
  /** 한 줄 요약 */
  summary: string;
  /** 제목줄 오른쪽(상태 문구 옆) 액션 문구([연결하기]·[보정하기]·[보기]) */
  actionText: string;
  /** 누르면 팝업을 연다 */
  onOpen: () => void;
  /** 연주 준비에서 돌아가려고 꼭 채워야 하는 단계(복귀 띠가 떠 있을 때): 필요 상태를 빨강으로 */
  urgent?: boolean;
  /** 모자란 단계를 눈에 띄게(재정렬 필요 포함). 팝업은 자동으로 열지 않고 타일만 강조한다 */
  attention?: boolean;
  /** 열 수 없을 때(보정 중). 이유는 reason으로 알린다 */
  disabled?: boolean;
  /** 비활성 이유(타일 안 보조 문구) */
  reason?: string;
  /** 상태 글자를 주의색으로 보인다(is-todo). 테두리 강조는 하지 않는다(박자 맞추기를 안 맞췄을 때) */
  statusWarn?: boolean;
}

export function StatusTile({ id, title, status, statusText, summary, actionText, onOpen, urgent = false, attention = false, disabled = false, reason, statusWarn = false }: Props) {
  const on = status === 'done';
  const needed = status === 'needed';
  const tone = on ? 'on' : needed && urgent ? 'urgent' : needed && attention ? 'attention' : 'off';
  return (
    <StrikeButton type="button" id={id} className={`setup-tile is-${tone}${statusWarn ? ' is-todo' : ''}`} aria-haspopup="dialog" disabled={disabled} onClick={onOpen}>
      <span className="setup-tile-top">
        <span className="setup-tile-dot" aria-hidden="true" />
        <span className="setup-tile-title">{title}</span>
        <span className="setup-tile-status">{statusText}</span>
        <span className="setup-tile-action" aria-hidden="true">
          {actionText}
        </span>
      </span>
      <span className="setup-tile-summary">{summary}</span>
      {reason && <span className="setup-tile-reason">{reason}</span>}
    </StrikeButton>
  );
}
