import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SsafyIcon } from './ProviderIcons';

describe('SsafyIcon', () => {
  it('SSAFY 로고 이미지를 장식 이미지로 그린다', () => {
    const html = renderToStaticMarkup(<SsafyIcon />);
    expect(html).toContain('src="/images/ssafy-logo.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it('size 칸 안에 비율을 유지해 넣는다', () => {
    const html = renderToStaticMarkup(<SsafyIcon size={24} />);
    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
    expect(html).toContain('object-fit:contain');
  });
});
