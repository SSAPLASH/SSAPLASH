// 다이얼로그 포커스 훅(D4·D5). 열릴 때 초점, Tab 순환, Esc 콜백, 닫힐 때 복원/해제를 맡는다.
// keydown 리스너는 window가 아니라 다이얼로그 요소에 건다 — 전역 핸들러와 겹치지 않게 한다.
// Enter·Space는 관여하지 않고 포커스된 버튼의 기본 클릭에 맡긴다.
import { useEffect, type RefObject } from 'react';
import { cycleIndex, initialFocusIndex } from './focusCycle';

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  /** 열림 여부. 마운트 = 열림인 컴포넌트는 true 고정 */
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  /** 열릴 때 초점을 둘 요소. 없거나 disabled면 첫 활성 요소 */
  initialRef?: RefObject<HTMLElement | null>;
  /** Esc 콜백. 없으면 Esc는 무시한다 */
  onEscape?: () => void;
  /** 닫힐 때 처리. 'restore'는 이전 요소(문서에 남아 있을 때만), 'blur'는 body로 보낸다 */
  returnFocus?: 'restore' | 'blur';
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function useDialogFocus({ open, dialogRef, initialRef, onEscape, returnFocus = 'restore' }: Options): void {
  // 열림·닫힘: 초점 이동과 복원
  useEffect(() => {
    const root = dialogRef.current;
    if (!open || !root) return;
    const previous = document.activeElement as HTMLElement | null;
    const items = focusables(root);
    const preferred = initialRef?.current ? items.indexOf(initialRef.current) : -1;
    const idx = initialFocusIndex(
      items.map((el) => !(el as HTMLButtonElement).disabled),
      preferred >= 0 ? preferred : null,
    );
    if (idx >= 0) items[idx].focus();
    return () => {
      if (returnFocus === 'blur') {
        (document.activeElement as HTMLElement | null)?.blur();
      } else if (previous && previous !== document.body && previous.isConnected) {
        previous.focus();
      }
    };
    // 열림 상태가 바뀔 때만 실행한다. 옵션 ref는 마운트 시점 값을 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tab 순환·Esc
  useEffect(() => {
    const root = dialogRef.current;
    if (!open || !root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Tab') {
        const items = focusables(root);
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = cycleIndex(items.length, current, e.shiftKey);
        if (next >= 0) items[next].focus();
        e.preventDefault();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        onEscape?.();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [open, dialogRef, onEscape]);
}
