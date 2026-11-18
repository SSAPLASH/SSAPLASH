import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KIT_SKINS, KIT_SKIN_LABELS } from '@/domain/kit/drumKit';
import { KitSkinCarousel } from './KitSkinCarousel';
import { nextSkin } from '@/features/settings/domain/carouselStep';

describe('nextSkin', () => {
  it('다음·이전으로 넘기고 끝에서 순환한다', () => {
    expect(nextSkin('acoustic', 1)).toBe('electronic');
    expect(nextSkin('electronic', 1)).toBe('neon');
    expect(nextSkin('neon', 1)).toBe('acoustic');
    expect(nextSkin('acoustic', -1)).toBe('neon');
    expect(nextSkin('neon', -1)).toBe('electronic');
  });
});

describe('KitSkinCarousel', () => {
  KIT_SKINS.forEach((skin, i) => {
    it(`${skin}: 이름·n / 3·활성 점 하나`, () => {
      const html = renderToStaticMarkup(<KitSkinCarousel value={skin} onChange={() => {}} />);
      expect(html).toContain(KIT_SKIN_LABELS[skin]);
      expect(html).toContain(`${i + 1} / 3`);
      expect(html.match(/kit-skin-dot active/g)).toHaveLength(1);
      expect(html.match(/class="kit-skin-dot[ "]/g)).toHaveLength(3);
    });
  });

  it('접근성 속성', () => {
    const html = renderToStaticMarkup(<KitSkinCarousel value="neon" onChange={() => {}} labelledBy="lbl" />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-labelledby="lbl"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="이전 드럼 모양"');
    expect(html).toContain('aria-label="다음 드럼 모양"');
  });
});
