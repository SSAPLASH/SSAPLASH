import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MoreMenu } from './MoreMenu';

type MenuEl = ReactElement<{ children: (api: { close: () => void }) => ReactNode }>;

const ITEMS = [
  { key: 'rename', label: '제목 변경' },
  { key: 'delete', label: '삭제', danger: true },
];

// Menu는 닫힌 채 렌더되므로 SSR로는 항목이 보이지 않는다. MoreMenu가 돌려준 Menu 요소의 children 함수를 직접 불러 항목만 그린다.
function menuEl(onPick: (key: string) => void = () => {}): MenuEl {
  return MoreMenu({ label: '메뉴', items: ITEMS, onPick }) as MenuEl;
}

describe('MoreMenu', () => {
  it('트리거는 IconButton sm이고 aria-label·aria-haspopup을 가진다', () => {
    const html = renderToStaticMarkup(<MoreMenu label="녹음 메뉴" items={ITEMS} onPick={() => {}} />);
    expect(html).toContain('ui-more-menu');
    expect(html).toContain('ui-icon-btn ui-icon-btn-sm ui-more-menu-btn');
    expect(html).toContain('aria-label="녹음 메뉴"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('role="menuitem"');
  });

  it('className·triggerClassName을 덧붙인다', () => {
    const html = renderToStaticMarkup(
      <MoreMenu label="m" items={ITEMS} onPick={() => {}} className="extra-wrap" triggerClassName="extra-btn" />,
    );
    expect(html).toContain('class="ui-more-menu extra-wrap"');
    expect(html).toContain('ui-more-menu-btn extra-btn');
  });

  it('항목 label과 danger 클래스를 그린다', () => {
    const html = renderToStaticMarkup(<>{menuEl().props.children({ close: () => {} })}</>);
    const labels = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(['제목 변경', '삭제']);
    expect(html.match(/ui-more-menu-item danger/g)).toHaveLength(1);
    expect(html).toMatch(/ui-more-menu-item danger"[^>]*>삭제/);
  });

  it('항목을 누르면 메뉴를 닫고 key를 알린다', () => {
    const onPick = vi.fn();
    const close = vi.fn();
    const btns = menuEl(onPick).props.children({ close }) as ReactElement<{ onClick: () => void }>[];
    btns[1].props.onClick();
    expect(close).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith('delete');
  });

  it('항목이 없으면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<MoreMenu label="m" items={[]} onPick={() => {}} />)).toBe('');
  });
});
