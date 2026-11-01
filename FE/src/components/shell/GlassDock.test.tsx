import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GlassDock } from './GlassDock';

describe('GlassDock 마크업', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <GlassDock />
    </MemoryRouter>,
  );

  it('아이콘 버튼은 IconButton sm(BPM ±·접기)', () => {
    expect(html).toMatch(/ui-icon-btn ui-icon-btn-sm[^>]*aria-label="BPM 5 감소"/);
    expect(html).toMatch(/ui-icon-btn ui-icon-btn-sm[^>]*aria-label="BPM 5 증가"/);
    expect(html).toMatch(/ui-icon-btn-sm dock-collapse[^>]*aria-label="Dock 접기"/);
    expect(html).not.toContain('dock-icon-btn');
  });

  it('패드 소리·메트로놈 스위치는 role=switch와 aria-checked', () => {
    expect((html.match(/role="switch"/g) ?? []).length).toBe(2);
    expect((html.match(/aria-checked="/g) ?? []).length).toBe(2);
  });
});
