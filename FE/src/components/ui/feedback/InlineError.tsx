// 알림 줄형 오류 — 목록·카드·머리 등 다른 내용 옆에 붙는 오류 한 줄. 문구 + (있으면) [다시 시도] 글자 버튼.
// 내용 폭만큼만 차지하는 캡슐(높이 32, 작은 버튼·토글과 같은 줄 높이)이고 버튼은 항상 문구와 같은 줄에 있다.
// 구역 전체가 비는 오류는 ErrorState를 쓴다.
import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '@/components/ui/action/Button';
import './InlineError.css';

export interface InlineErrorProps extends HTMLAttributes<HTMLDivElement> {
  /** 오류 문구 */
  children: ReactNode;
  /** 있으면 [다시 시도] 글자 버튼을 그린다 */
  onRetry?: () => void;
  retryLabel?: string;
  /** 바탕·아이콘 없이 글자색만 오류색 — 곡 카드·재생 바처럼 좁은 자리 */
  plain?: boolean;
  /** lg는 화면·구역 가운데에 혼자 뜨는 자리용: 높이 44, 글자·버튼이 함께 커진다(plain에는 쓰지 않는다) */
  size?: 'md' | 'lg';
  /** 추가 버튼·링크(예: 로그인 링크) */
  action?: ReactNode;
}

function AlertIcon() {
  return (
    <svg className="ui-inline-error-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path d="M7 3.6v4.1" stroke="var(--bg-base)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="10.1" r="0.95" fill="var(--bg-base)" />
    </svg>
  );
}

export function InlineError({ children, onRetry, retryLabel = '다시 시도', plain = false, size = 'md', action, className, ...rest }: InlineErrorProps) {
  const cls = ['ui-inline-error', plain ? 'is-plain' : 'is-pill', !plain && size === 'lg' ? 'is-lg' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role="alert" {...rest}>
      {plain ? null : <AlertIcon />}
      <span className="ui-inline-error-text">{children}</span>
      {onRetry ? (
        <Button variant="text" size="sm" className="ui-inline-error-retry" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
      {action}
    </div>
  );
}
