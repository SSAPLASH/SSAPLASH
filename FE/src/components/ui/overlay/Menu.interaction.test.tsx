// @vitest-environment happy-dom
// 공용 Menu(Radix Popover 기반, QA 352): 열고 닫기·Esc/항목 선택 뒤 초점 복귀·portal 위치·위로 펼침 설정.
// happy-dom은 레이아웃이 없어 실제 뒤집힘 좌표는 못 본다 — Content가 side·collisionPadding을 받아 data-side를 붙이는지까지만 본다.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { Menu } from './Menu';

function TestMenu({ onPick = () => {}, onOpenChange }: { onPick?: () => void; onOpenChange?: (o: boolean) => void }) {
  return (
    <Menu
      className="wrap"
      menuClassName="pop"
      menuLabel="테스트 메뉴"
      onOpenChange={onOpenChange}
      renderTrigger={({ triggerProps }) => (
        <button type="button" {...triggerProps}>
          열기
        </button>
      )}
    >
      {({ close }) => (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            onPick();
          }}
        >
          항목
        </button>
      )}
    </Menu>
  );
}

afterEach(cleanup);

describe('Menu 열고 닫기', () => {
  it('트리거를 누르면 role=menu가 열리고 aria-expanded가 바뀐다. 다시 누르면 닫힌다', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<TestMenu onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: '열기' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(trigger);
    expect(screen.getByRole('menu', { name: '테스트 메뉴' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('열 때 초점은 트리거에 그대로 둔다', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);
    const trigger = screen.getByRole('button', { name: '열기' });
    await user.click(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it('바깥을 누르면 닫히고 초점을 가져오지 않는다', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">바깥</button>
        <TestMenu />
      </>,
    );
    await user.click(screen.getByRole('button', { name: '열기' }));
    await user.click(screen.getByRole('button', { name: '바깥' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '바깥' }));
  });

  it('Esc로 닫히고 초점이 트리거로 돌아온다', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);
    const trigger = screen.getByRole('button', { name: '열기' });
    await user.click(trigger);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('항목을 고르면 닫히고 onPick이 불리며 초점이 트리거로 돌아온다', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<TestMenu onPick={onPick} />);
    const trigger = screen.getByRole('button', { name: '열기' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: '항목' }));
    expect(onPick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('Menu 위치', () => {
  it('팝오버는 body 끝(portal)에 그려지고 클래스에 .motion-menu가 붙는다', async () => {
    const user = userEvent.setup();
    const { container } = render(<TestMenu />);
    await user.click(screen.getByRole('button', { name: '열기' }));
    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.className).toContain('pop');
    expect(menu.className).toContain('motion-menu');
  });

  it('기본은 아래로 펼치며(data-side=bottom) 정렬은 end가 오른쪽 가장자리 맞춤이다', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);
    await user.click(screen.getByRole('button', { name: '열기' }));
    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('data-side')).toBe('bottom');
    expect(menu.getAttribute('data-align')).toBe('end');
  });

  it('align=start는 data-align=start로 넘어간다', async () => {
    const user = userEvent.setup();
    render(
      <Menu align="start" renderTrigger={({ triggerProps }) => <button type="button" {...triggerProps}>열기</button>}>
        <span>내용</span>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: '열기' }));
    expect(screen.getByRole('menu').getAttribute('data-align')).toBe('start');
  });
});

describe('Menu가 다이얼로그 안에 있을 때', () => {
  function InDialog({ onClose }: { onClose: () => void }) {
    return (
      <Dialog onClose={onClose} label="창">
        <TestMenu />
      </Dialog>
    );
  }

  it('팝오버가 body가 아니라 그 .dialog 안에 그려진다', async () => {
    const user = userEvent.setup();
    render(<InDialog onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: '열기' }));
    const menu = screen.getByRole('menu');
    expect(menu.closest('.dialog')).not.toBeNull();
  });

  it('메뉴를 열고 항목을 골라도 창이 닫히지 않고 초점이 트리거로 돌아온다', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<InDialog onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: '열기' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: '항목' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
