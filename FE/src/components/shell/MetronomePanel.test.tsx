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
});
