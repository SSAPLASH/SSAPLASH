// @vitest-environment happy-dom
// 공용 Menu의 선택 옵션(설계 CHART-003): focusFirstItem(열 때 첫 항목 초점)·arrowNav(↑/↓ 순환, Home/End). 기본은 둘 다 꺼짐이다.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Menu } from './Menu';

function TestMenu(props: { focusFirstItem?: boolean; arrowNav?: boolean }) {
  return (
    <Menu
      menuLabel="테스트 메뉴"
      renderTrigger={({ triggerProps }) => (
        <button type="button" {...triggerProps}>
          열기
        </button>
      )}
      {...props}
    >
      {['가', '나', '다'].map((name) => (
        <button key={name} type="button" role="menuitem">
          {name}
        </button>
      ))}
    </Menu>
  );
}

afterEach(cleanup);

describe('Menu focusFirstItem', () => {
  it('켜면 열릴 때 첫 항목에 초점이 간다', async () => {
    const user = userEvent.setup();
    render(<TestMenu focusFirstItem />);
    await user.click(screen.getByRole('button', { name: '열기' }));
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '가' }));
  });

  it('기본(꺼짐)은 초점이 트리거에 남는다', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);
    const trigger = screen.getByRole('button', { name: '열기' });
    await user.click(trigger);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Menu arrowNav', () => {
  it('켜면 ↓/↑가 항목을 순환하고 Home/End가 처음·끝으로 보낸다', async () => {
    const user = userEvent.setup();
    render(<TestMenu focusFirstItem arrowNav />);
    await user.click(screen.getByRole('button', { name: '열기' }));
    const [a, b, c] = ['가', '나', '다'].map((n) => screen.getByRole('menuitem', { name: n }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(b);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(c);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(a);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(c);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(a);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(c);
  });

  it('꺼져 있으면 ↓가 항목을 옮기지 않는다', async () => {
    const user = userEvent.setup();
    render(<TestMenu focusFirstItem />);
    await user.click(screen.getByRole('button', { name: '열기' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '가' }));
  });

  it('Esc는 닫고 초점을 트리거로 돌린다', async () => {
    const user = userEvent.setup();
    render(<TestMenu focusFirstItem arrowNav />);
    const trigger = screen.getByRole('button', { name: '열기' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
