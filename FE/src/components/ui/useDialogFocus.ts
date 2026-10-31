// 다이얼로그 포커스 훅(D4·D5). 열릴 때 초점, Tab 순환, Esc 콜백, 닫힐 때 복원/해제를 맡는다.
// keydown 리스너는 document capture 단계에 건다 — 포커스가 body(스크림 클릭 뒤·버튼 언마운트 뒤)여도 Tab·Esc가 동작해야 한다.
// 페이지 전역 핸들러는 defaultPrevented를 먼저 확인하므로 처리한 키는 중복되지 않는다.
// Enter·Space는 관여하지 않고 포커스된 버튼의 기본 클릭에 맡긴다.
import { useEffect, type RefObject } from 'react';
import { cycleIndex, initialFocusIndex, needsRefocus } from './focusCycle';

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
  /** 열릴 때 초점을 옮길지(기본 true). false면 호출자가 초기 초점을 직접 정한다 */
  autoFocus?: boolean;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** 초기 초점 규칙: initialRef가 활성이면 그 요소, 아니면 첫 활성 요소 */
function focusInitial(root: HTMLElement, initialRef?: RefObject<HTMLElement | null>): void {
  const items = focusables(root);
  const preferred = initialRef?.current ? items.indexOf(initialRef.current) : -1;
  const idx = initialFocusIndex(
    items.map((el) => !(el as HTMLButtonElement).disabled),
    preferred >= 0 ? preferred : null,
  );
  if (idx >= 0) items[idx].focus();
}

export function useDialogFocus({ open, dialogRef, initialRef, onEscape, returnFocus = 'restore', autoFocus = true }: Options): void {
  // 열림·닫힘: 초점 이동과 복원
  useEffect(() => {
    const root = dialogRef.current;
    if (!open || !root) return;
    const previous = document.activeElement as HTMLElement | null;
    if (autoFocus) focusInitial(root, initialRef);
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

  // Tab 순환·Esc. 포커스가 다이얼로그 안이든 body·밖이든 처리한다(밖이면 Tab은 처음/끝부터)
  useEffect(() => {
    const root = dialogRef.current;
    if (!open || !root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
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
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, dialogRef, onEscape]);

  // 포커스가 있던 안쪽 요소가 문서에서 사라져 body로 떨어지면 초기 초점 규칙으로 되돌린다.
  // 스크림 클릭처럼 요소가 남은 채 빠진 경우는 건드리지 않는다(Esc·Tab이 키로 해결)
  useEffect(() => {
    const root = dialogRef.current;
    if (!open || !root) return;
    // 열림 effect가 이미 준 초기 초점부터 추적한다(이 effect는 그 뒤에 등록된다)
    let last: HTMLElement | null = root.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const onFocusIn = (e: FocusEvent) => {
      last = e.target as HTMLElement;
    };
    // 마우스로 포커스를 뺀 뒤에는 이전 요소를 추적하지 않는다. 버튼을 누르면 이어서 focusin이 다시 기록한다
    const onPointerDown = () => {
      last = null;
    };
    const observer = new MutationObserver(() => {
      if (
        last &&
        needsRefocus(true, last.isConnected, document.activeElement === document.body || !document.activeElement)
      ) {
        last = null;
        focusInitial(root, initialRef);
      }
    });
    root.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      root.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
      observer.disconnect();
    };
    // 옵션 ref는 마운트 시점 값을 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dialogRef]);
}
