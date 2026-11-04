import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MoreMenu } from '@/components/ui/MoreMenu';
import { SongMenu, type SongEditKind } from './SongMenu';

type MenuEl = ReactElement<{ children: (api: { close: () => void }) => ReactNode }>;

// Menu는 닫힌 채 렌더되므로 SSR로는 항목이 보이지 않는다. SongMenu → MoreMenu가 돌려준 Menu 요소의 children 함수를 직접 불러 항목만 그린다.
function menuEl(status: string, onPick: (kind: SongEditKind) => void = () => {}): MenuEl {
  const more = SongMenu({ title: '별빛 산책', status, onPick }) as ReactElement<ComponentProps<typeof MoreMenu>>;
  return MoreMenu(more.props) as MenuEl;
}

function items(status: string): string {
  const el = menuEl(status);
  return renderToStaticMarkup(<>{el.props.children({ close: () => {} })}</>);
}

describe('SongMenu', () => {
  it('트리거는 IconButton sm이고 곡 제목이 들어간 라벨을 가진다', () => {
    const html = renderToStaticMarkup(<SongMenu title="별빛 산책" status="READY" onPick={() => {}} />);
    expect(html).toContain('ui-icon-btn ui-icon-btn-sm');
    expect(html).toContain('aria-label="별빛 산책 메뉴"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menuitem"');
  });

  it('완료 곡: 커버 변경·곡 정보 수정·곡 삭제 순서, 삭제만 위험 표시', () => {
    const html = items('READY');
    const labels = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(['커버 변경', '곡 정보 수정', '곡 삭제']);
    expect(html.match(/ui-more-menu-item danger/g)).toHaveLength(1);
    expect(html).toMatch(/ui-more-menu-item danger"[^>]*>곡 삭제/);
  });

  it('실패 곡: 곡 삭제만', () => {
    const html = items('FAILED');
    expect(html.match(/role="menuitem"/g)).toHaveLength(1);
    expect(html).toContain('곡 삭제');
    expect(html).not.toContain('커버 변경');
  });

  it('처리 중 곡은 메뉴 자체를 그리지 않는다', () => {
    expect(renderToStaticMarkup(<SongMenu title="a" status="PROCESSING" onPick={() => {}} />)).toBe('');
  });

  it('항목을 누르면 메뉴를 닫고 종류를 알린다', () => {
    const onPick = vi.fn();
    const close = vi.fn();
    const el = menuEl('FAILED', onPick);
    const btn = (el.props.children({ close }) as ReactElement<{ onClick: () => void }>[])[0];
    btn.props.onClick();
    expect(close).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith('delete');
  });
});
