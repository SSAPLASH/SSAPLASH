import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SoundIcon } from './SoundIcon';

describe('SoundIcon', () => {
  it('기본 크기 20, 장식이라 aria-hidden', () => {
    const html = renderToStaticMarkup(<SoundIcon on />);
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('size를 줄 수 있다', () => {
    expect(renderToStaticMarkup(<SoundIcon on size={16} />)).toContain('width="16"');
  });

  it('켬은 음파, 끔은 엑스 그림', () => {
    expect(renderToStaticMarkup(<SoundIcon on />)).toContain('M16.5 8.5');
    expect(renderToStaticMarkup(<SoundIcon on />)).not.toContain('M17 9l5 6');
    expect(renderToStaticMarkup(<SoundIcon on={false} />)).toContain('M17 9l5 6');
    expect(renderToStaticMarkup(<SoundIcon on={false} />)).not.toContain('M16.5 8.5');
  });
});
