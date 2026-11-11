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

  it('리듬 게임(gameDisabled)이면 켜기·BPM·박자·탭이 모두 비활성이고 안내가 있다', () => {
    const game = renderToStaticMarkup(<MetronomePanel gameDisabled />);
    expect(game).toMatch(/<button[^>]*role="switch"[^>]*disabled|<button[^>]*disabled[^>]*role="switch"/);
    expect(game).toMatch(/aria-label="BPM 5 감소"[^>]*disabled|disabled[^>]*aria-label="BPM 5 감소"/);
    expect(game).toMatch(/ui-btn ui-btn-secondary ui-btn-sm[^>]*disabled[^>]*>탭 템포</);
    expect(game).toContain('리듬 게임에서는 메트로놈을 쓰지 않아요');
    // 기본(악보 등)에서는 비활성이 아니다
    expect(html).not.toContain('리듬 게임에서는');
  });

  it('BPM ± 는 IconButton sm, 탭 템포는 secondary sm 버튼', () => {
    expect(html).toMatch(/ui-icon-btn ui-icon-btn-sm[^>]*aria-label="BPM 5 감소"/);
    expect(html).toMatch(/ui-icon-btn ui-icon-btn-sm[^>]*aria-label="BPM 5 증가"/);
    expect(html).toMatch(/ui-btn ui-btn-secondary ui-btn-sm[^>]*>탭 템포</);
    expect(html).not.toContain('metro-panel-step');
    expect(html).not.toContain('metro-panel-tap');
  });
});
