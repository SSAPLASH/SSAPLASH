// 페이지 제목 머리 (설계 QA-page-header-dock-fold). 제목(h2) + 제목 옆 작은 정보(meta) + 오른쪽 동작 자리(actions).
// 제목 아래 설명 줄은 두지 않는다(QA). 화면 이름 h1은 상단 바가 맡는다.
import type { ReactNode } from 'react';
import './PageHeader.css';

export interface PageHeaderProps {
  title: ReactNode;
  /** 제목 오른쪽에 붙는 작은 글씨(예: 라이브러리 「곡 n개」) */
  meta?: ReactNode;
  /** 머리 오른쪽 끝(버튼·진행 표시) */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={['ui-page-head', className ?? ''].filter(Boolean).join(' ')}>
      <div className="ui-page-head-title">
        <h2 className="ui-page-title t-title-36">{title}</h2>
        {meta != null && meta !== '' && <span className="ui-page-meta">{meta}</span>}
      </div>
      {actions != null && <div className="ui-page-actions">{actions}</div>}
    </header>
  );
}
