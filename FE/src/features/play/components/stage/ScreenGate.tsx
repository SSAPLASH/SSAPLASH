// 세로·좁은 화면 차단 안내. 화면을 바꿔 끼우지 않고 위에 덮어 세션·반주 상태를 보존한다(MODE-003 D8).
// 포커스: 안내 자체(tabIndex -1)에 두고, Tab·Esc는 useDialogFocus가 가둔다. 버튼이 없다.
import { useEffect, useRef } from 'react';
import { useDialogFocus } from '@/components/ui/overlay/useDialogFocus';
import './ScreenGate.css';

interface Props {
  open: boolean;
}

export function ScreenGate({ open }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ open, dialogRef, autoFocus: false, returnFocus: 'restore' });
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="screen-gate-scrim">
      <div
        ref={dialogRef}
        className="screen-gate"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="screen-gate-title"
        aria-describedby="screen-gate-desc"
        tabIndex={-1}
      >
        <h2 id="screen-gate-title" className="screen-gate-title">
          가로 화면에서 연습할 수 있어요
        </h2>
        <p id="screen-gate-desc" className="screen-gate-desc">
          기기를 가로로 돌리거나 창을 넓혀 주세요
        </p>
      </div>
    </div>
  );
}
