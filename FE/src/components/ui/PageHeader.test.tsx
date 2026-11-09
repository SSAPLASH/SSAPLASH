import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader (설계 QA-page-header-dock-fold)', () => {
  it('제목은 h2 36px 토큰이고 설명 줄은 없다', () => {
    const html = renderToStaticMarkup(<PageHeader title="설정" />);
    expect(html).toContain('<h2 class="ui-page-title t-title-36">설정</h2>');
    expect(html).not.toContain('<p');
    expect(html).not.toContain('ui-page-meta');
    expect(html).not.toContain('ui-page-actions');
  });

  it('meta는 제목 옆, actions는 오른쪽 끝', () => {
    const html = renderToStaticMarkup(<PageHeader title="라이브러리" meta="곡 2개" actions={<button type="button">올리기</button>} className="x" />);
    expect(html).toMatch(/^<header class="ui-page-head x">/);
    expect(html).toMatch(/<\/h2><span class="ui-page-meta">곡 2개<\/span><\/div><div class="ui-page-actions"><button/);
  });

  it('빈 meta는 그리지 않는다', () => {
    expect(renderToStaticMarkup(<PageHeader title="t" meta="" />)).not.toContain('ui-page-meta');
  });
});
