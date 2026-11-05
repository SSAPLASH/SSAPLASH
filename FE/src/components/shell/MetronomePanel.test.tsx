import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MetronomePanel } from './MetronomePanel';

describe('MetronomePanel 마크업', () => {
  const html = renderToStaticMarkup(<MetronomePanel />);

  it('켜기 토글은 role=switch', () => {
    expect(html).toContain('role="switch"');
  });

  it('박자 선택은 3/4·4/4 둘뿐', () => {
    expect(html).toContain('4/4');
    expect(html).toContain('3/4');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(2);
  });

  it('음량 슬라이더와 탭 템포 버튼', () => {
    expect(html).toContain('type="range"');
    expect(html).toContain('메트로놈 음량');
    expect(html).toContain('탭 템포');
  });

  it('BPM ± 는 IconButton sm, 탭 템포는 secondary sm 버튼', () => {
    expect(html).toMatch(/ui-icon-btn ui-icon-btn-sm[^>]*aria-label="BPM 5 감소"/);
    expect(html).toMatch(/ui-icon-btn ui-icon-btn-sm[^>]*aria-label="BPM 5 증가"/);
    expect(html).toMatch(/ui-btn ui-btn-secondary ui-btn-sm[^>]*>탭 템포</);
    expect(html).not.toContain('metro-panel-step');
    expect(html).not.toContain('metro-panel-tap');
  });
});
