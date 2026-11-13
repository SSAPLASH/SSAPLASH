import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('기본은 h3·보통 크기이고 아이콘을 그린다', () => {
    const html = renderToStaticMarkup(<EmptyState icon={<svg />} title="비었어요" description="설명" />);
    expect(html).toContain('<h3 class="ui-empty-title">비었어요</h3>');
    expect(html).toContain('ui-empty-icon');
    expect(html).not.toContain('ui-empty-sm');
  });

  it('headingLevel 2면 h2', () => {
    const html = renderToStaticMarkup(<EmptyState headingLevel={2} title="제목" />);
    expect(html).toContain('<h2 class="ui-empty-title">제목</h2>');
    expect(html).not.toContain('<h3');
  });

  it('size sm이면 작은 모양 클래스가 붙고 아이콘을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<EmptyState size="sm" icon={<svg />} title="조건에 맞는 기록이 없어요" className="x" />);
    expect(html).toContain('class="ui-empty ui-empty-sm x"');
    expect(html).not.toContain('ui-empty-icon');
  });
});
