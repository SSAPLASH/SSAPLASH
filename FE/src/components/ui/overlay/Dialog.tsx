// 공용 다이얼로그 틀. 기존 `.dialog-backdrop > .dialog` 마크업·클래스를 그대로 쓴다(스타일은 global.css).
// 포커스(초기 초점·Tab 순환·Esc·복원)는 useDialogFocus가 맡는다. 열림은 호출자가 마운트 여부로 정한다.
import { useEffect, useRef, type FormEventHandler, type ReactNode, type RefObject } from 'react';
import { useDialogFocus } from './useDialogFocus';

interface Props {
  /** Esc·배경 클릭으로 닫을 때 호출 */
  onClose: () => void;
  /** 제목 요소 id (aria-labelledby) */
  labelledBy?: string;
  /** 제목 요소가 없을 때 쓰는 이름 (aria-label) */
  label?: string;
  /** 열릴 때 초점을 둘 요소. 없으면 창 자체에 초점을 둔다(안쪽에 이미 초점이 있으면 그대로) */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 배경을 직접 눌렀을 때 닫는다. 기본 true */
  closeOnBackdrop?: boolean;
  /** Esc로 닫는다. 기본 true. 저장 중처럼 잠글 때 false */
  closeOnEscape?: boolean;
  /** 패널 요소. 'form'이면 패널이 곧 폼이다(Enter 제출 등) */
  as?: 'div' | 'form';
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** 패널에 덧붙일 클래스 (예: upload-dialog) */
  className?: string;
  /** 배경(스크림)에 덧붙일 클래스. 창마다 스크림 모양을 달리할 때 쓴다 (예: start-dialog-backdrop) */
  backdropClassName?: string;
  children: ReactNode;
}

export function Dialog({
  onClose,
  labelledBy,
  label,
  initialFocusRef,
  closeOnBackdrop = true,
  closeOnEscape = true,
  as = 'div',
  onSubmit,
  className,
  backdropClassName,
  children,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const hasInitial = initialFocusRef !== undefined;

  useDialogFocus({
    open: true,
    dialogRef: panelRef,
    initialRef: initialFocusRef,
    onEscape: closeOnEscape ? onClose : undefined,
    autoFocus: hasInitial,
  });

  // 초기 초점 대상이 없으면 창 자체에 둔다(탭 순서가 창 안에서 시작). 안쪽에서 이미 가져갔으면 건드리지 않는다
  useEffect(() => {
    const el = panelRef.current;
    if (!hasInitial && el && !el.contains(document.activeElement)) el.focus();
  }, [hasInitial]);

  const common = {
    className: className ? `dialog ${className}` : 'dialog',
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': labelledBy,
    'aria-label': label,
    tabIndex: hasInitial ? undefined : -1,
  } as const;

  return (
    <div
      className={backdropClassName ? `dialog-backdrop ${backdropClassName}` : 'dialog-backdrop'}
      onMouseDown={(e) => {
        // 배경을 직접 눌렀을 때만 닫는다(창 안 드래그가 밖에서 끝나는 경우는 제외)
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      {as === 'form' ? (
        <form {...common} ref={panelRef as RefObject<HTMLFormElement>} onSubmit={onSubmit}>
          {children}
        </form>
      ) : (
        <div {...common} ref={panelRef as RefObject<HTMLDivElement>}>
          {children}
        </div>
      )}
    </div>
  );
}
