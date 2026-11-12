// 트리거 + 팝오버 메뉴 공용 틀 (Figma Studio / MoreMenu 212:757, Navigation / ProfileMenu 126:2142).
// 열림 상태·바깥 클릭·Esc(트리거로 초점 복원)를 맡고, 모양은 호출부가 넘기는 클래스가 정한다.
// 팝오버는 Radix Popover로 body 끝(portal)에 그린다 — 조상의 overflow에 잘리지 않고, 아래 공간이 모자라면 Radix가 위로 뒤집는다(data-side="top").
// 공용 Dialog(.dialog) 안의 트리거는 그 창 안에 그린다 — 다이얼로그 포커스 가두기(useDialogFocus)가 메뉴로 간 초점을 되돌리지 않게 한다.
import * as Popover from '@radix-ui/react-popover';
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

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
  /** 팝오버를 트리거의 어느 쪽 가장자리에 맞출지 (start = 왼쪽, end = 오른쪽). 세로는 아래로 펼치되 모자라면 위로 뒤집힌다 */
  align?: 'start' | 'end';
  /** 트리거를 감싸는 요소의 클래스 */
  className?: string;
  /** 팝오버 요소의 클래스 (.motion-menu는 항상 붙는다) */
  menuClassName?: string;
  /** 팝오버 aria-label */
  menuLabel?: string;
  onOpenChange?: (open: boolean) => void;
  /** 열릴 때 첫 [role=menuitem]에 초점을 둔다(기본 꺼짐: 초점은 트리거에 남는다) */
  focusFirstItem?: boolean;
  /** 메뉴 안에서 ↑/↓로 항목을 순환 이동하고 Home/End로 처음·끝으로 간다(기본 꺼짐) */
  arrowNav?: boolean;
}

export function Menu({
  renderTrigger,
  children,
  align = 'end',
  className,
  menuClassName,
  menuLabel,
  onOpenChange,
  focusFirstItem = false,
  arrowNav = false,
}: Props) {
  const [open, setOpenState] = useState(false);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 바깥 클릭으로 닫힌 경우에는 초점을 트리거로 돌리지 않는다(사용자가 누른 곳이 초점을 가져간다)
  const outsideClosedRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const toggle = () => setOpen(!open);

  const items = () => Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  // ↑/↓는 항목을 순환하고 Home/End는 처음·끝으로 간다. Enter·Space는 링크·버튼 기본 동작에 맡긴다
  const onContentKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!arrowNav) return;
    const list = items();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    let to: number | null = null;
    if (e.key === 'ArrowDown') to = at < 0 ? 0 : (at + 1) % list.length;
    else if (e.key === 'ArrowUp') to = at <= 0 ? list.length - 1 : at - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    if (to === null) return;
    e.preventDefault();
    list[to].focus();
  };

  // 다이얼로그 안이면 그 창 요소에 그린다
  const container = wrapEl?.closest<HTMLElement>('.dialog') ?? undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Anchor asChild>
        <div className={className} ref={setWrapEl} data-align={align}>
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
        </div>
      </Popover.Anchor>
      <Popover.Portal container={container}>
        <Popover.Content
          ref={contentRef}
          className={menuClassName ? `${menuClassName} motion-menu` : 'motion-menu'}
          role="menu"
          aria-label={menuLabel}
          side="bottom"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          // 열 때 초점은 기본적으로 트리거에 둔다. focusFirstItem이면 첫 항목으로 옮긴다
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            outsideClosedRef.current = false;
            if (focusFirstItem) items()[0]?.focus();
          }}
          onKeyDown={onContentKeyDown}
          // 닫힐 때 초점은 트리거로. 바깥 클릭으로 닫힌 경우만 건드리지 않는다
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (!outsideClosedRef.current) triggerRef.current?.focus();
          }}
          onInteractOutside={(e) => {
            // 트리거를 누른 것은 바깥이 아니다 — 트리거의 toggle이 닫는다(여기서 닫으면 다시 열린다)
            if (wrapEl?.contains(e.target as Node)) {
              e.preventDefault();
              return;
            }
            outsideClosedRef.current = true;
          }}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
