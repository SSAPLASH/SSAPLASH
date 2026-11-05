// 토스트 (Figma Feedback / Toast 126:3908). 알림 영역은 항상 두고 내용만 바꾼다 — 화면 읽기 프로그램이 새 문구를 읽도록.
// 보이는 시간은 호출자가 정한다(text를 null로 바꾸면 사라진다). 위치는 regionClassName(호출부 CSS)이 정한다.
import type { ReactNode } from 'react';
import './Toast.css';

export type ToastVariant = 'info' | 'success' | 'error';

interface Props {
  variant: ToastVariant;
  text: ReactNode | null;
  /** 알림 영역(고정 위치 등)을 정하는 호출부 클래스 */
  regionClassName?: string;
}

export function Toast({ variant, text, regionClassName }: Props) {
  return (
    <div className={regionClassName} role="status" aria-live="polite">
      {text && (
        <div className={`ui-toast ui-toast-${variant} motion-toast`}>
          <span className="ui-toast-dot" aria-hidden="true" />
          <span className="ui-toast-text">{text}</span>
        </div>
      )}
    </div>
  );
}
