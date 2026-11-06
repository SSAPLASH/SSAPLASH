// Figma Setup / StatusTile 505:2449 — 드럼 세팅 상단 2열 상태 타일(스틱 연결·시작 위치 보정). 타일 전체가 버튼이고 누르면 아래로 펼친다.
// on=초록(연결됨·보정됨), off=회색(끊김·미설정). 상태 판정은 하지 않는다(호출자가 정한다).
import type { ReactNode } from 'react';
import type { SetupStepStatus } from '@/domain/setupSteps';
import './setup.css';

interface Props {
  /** 페이지가 scrollIntoView로 찾을 DOM id */
  id: string;
  title: string;
  status: SetupStepStatus;
  /** 상태 한 단어(「연결됨」「보정 필요」 …) */
  statusText: string;
  /** 한 줄 요약 */
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  /** 연주 준비에서 돌아가려고 꼭 채워야 하는 단계(복귀 띠가 떠 있을 때): 필요 상태를 빨강으로 */
  urgent?: boolean;
  /** 펼친 본문 */
  children?: ReactNode;
}

export function StatusTile({ id, title, status, statusText, summary, expanded, onToggle, urgent = false, children }: Props) {
  const on = status === 'done';
  const tone = on ? 'on' : status === 'needed' && urgent ? 'urgent' : 'off';
  return (
    <div className={`setup-tile-wrap${expanded ? ' expanded' : ''}`} id={id}>
      <button type="button" className={`setup-tile is-${tone}`} aria-expanded={expanded} aria-controls={`${id}-body`} onClick={onToggle}>
        <span className="setup-tile-top">
          <span className="setup-tile-dot" aria-hidden="true" />
          <span className="setup-tile-title">{title}</span>
          <img className="setup-tile-chevron" src="/icons/chevron-next.svg" alt="" width={20} height={20} aria-hidden="true" />
        </span>
        <span className="setup-tile-status">{statusText}</span>
        <span className="setup-tile-summary">{summary}</span>
      </button>
      {expanded && (
        <div id={`${id}-body`} className="setup-tile-body" role="region" aria-label={title}>
          {children}
        </div>
      )}
    </div>
  );
}
