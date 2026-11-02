// 트리거 + 팝오버 메뉴 공용 틀 (Figma Studio / MoreMenu 212:757, Navigation / ProfileMenu 126:2142).
// 열림 상태·바깥 클릭·Esc(트리거로 초점 복원)를 맡고, 모양은 호출부가 넘기는 클래스가 정한다.
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** 트리거 버튼에 펼쳐 걸 속성. ref는 Esc 초점 복원에 쓰이므로 반드시 걸어야 한다 */
export interface MenuTriggerAttrs {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
}

export interface MenuTriggerProps {
  open: boolean;
  toggle: () => void;
  close: () => void;
  triggerProps: MenuTriggerAttrs;
}

interface Props {
  renderTrigger: (props: MenuTriggerProps) => ReactNode;
  /** 메뉴 항목. 함수로 주면 close를 받는다(항목을 고른 뒤 닫기용) */
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
  /** 팝오버를 트리거의 어느 쪽에 맞출지. 실제 위치는 menuClassName의 CSS가 정하고, 여기서는 data-align으로만 표시한다 */
  align?: 'start' | 'end';
  /** 트리거+팝오버를 감싸는 요소의 클래스 */
  className?: string;
  /** 팝오버 요소의 클래스 (.motion-menu는 항상 붙는다) */
  menuClassName?: string;
  /** 팝오버 aria-label */
  menuLabel?: string;
  onOpenChange?: (open: boolean) => void;
}

export function Menu({ renderTrigger, children, align = 'end', className, menuClassName, menuLabel, onOpenChange }: Props) {
  const [open, setOpenState] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const toggle = () => setOpen(!open);

  // 바깥 클릭·Esc로 닫기 (열려 있을 때만 리스너를 건다). Esc면 트리거로 초점을 돌려준다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div className={className} ref={wrapRef} data-align={align}>
      {renderTrigger({
        open,
        toggle,
        close,
        triggerProps: {
          ref: triggerRef,
          onClick: toggle,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
        },
      })}
      {open && (
        <div className={menuClassName ? `${menuClassName} motion-menu` : 'motion-menu'} role="menu" aria-label={menuLabel}>
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}
