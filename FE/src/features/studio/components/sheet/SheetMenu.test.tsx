import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MoreMenu } from '@/components/ui/overlay/MoreMenu';
import { SheetMenu } from './SheetMenu';

type MenuEl = ReactElement<{ children: (api: { close: () => void }) => ReactNode }>;

describe('SheetMenu', () => {
  it('트리거 라벨에 제목이 들어간다', () => {
    const html = renderToStaticMarkup(<SheetMenu title="합주곡 악보" onPick={() => {}} />);
    expect(html).toContain('aria-label="합주곡 악보 메뉴"');
  });

  it('[제목 수정]·[악보 삭제] 순서, 삭제만 위험 표시, 선택하면 종류를 알린다', () => {
    const onPick = vi.fn();
    const more = SheetMenu({ title: 'a', onPick }) as ReactElement<ComponentProps<typeof MoreMenu>>;
    const el = MoreMenu(more.props) as MenuEl;
    const btns = el.props.children({ close: () => {} }) as ReactElement<{ onClick: () => void; children: string; className: string }>[];
    expect(btns.map((b) => b.props.children)).toEqual(['제목 수정', '악보 삭제']);
    expect(btns[1].props.className).toContain('danger');
    btns[1].props.onClick();
    expect(onPick).toHaveBeenCalledWith('delete');
  });
});
