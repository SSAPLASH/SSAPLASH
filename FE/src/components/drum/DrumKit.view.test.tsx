// DrumKit view(위에서 본 그림) 검증: 킷 상자·조각 이미지 폴더·전자/네온·자유 틀에서의 무시. SSR 문자열.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { kitBoxFor, smallKitSpec } from '@/domain/kit/drumKit';
import { kitFrame } from '@/domain/kit/kitFrame';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { DrumKit } from './DrumKit';
import { spriteUrl } from './acoustic/sprites';

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
/** <image>의 href들 */
const hrefs = (html: string) => [...html.matchAll(/<image[^>]*href="([^"]+)"/g)].map((m) => m[1] as string);

describe('DrumKit view', () => {
  it('top: viewBox·크기가 위에서 본 킷 상자이고 조각 12장을 top 폴더에서 가져온다', () => {
    const box = kitBoxFor('acoustic', 'top');
    const html = renderToStaticMarkup(<DrumKit view="top" scale={0.5} />);
    expect(html).toContain(`viewBox="0 0 ${box.w} ${box.h}"`);
    expect(html).toContain(`width="${box.w * 0.5}"`);
    expect(html).toContain(`height="${box.h * 0.5}"`);
    const urls = hrefs(html);
    expect(urls).toHaveLength(12);
    for (const u of urls) expect(u).toContain('/top/');
    for (const u of urls) expect(u).not.toContain('/persp/');
    expect(count(html, /class="drum-pad"/g)).toBe(9);
  });

  it('기본(persp)은 원근 상자와 persp 폴더 조각이다', () => {
    const box = kitBoxFor('acoustic', 'persp');
    const html = renderToStaticMarkup(<DrumKit />);
    expect(html).toContain(`viewBox="0 0 ${box.w} ${box.h}"`);
    const urls = hrefs(html);
    expect(urls).toHaveLength(12);
    for (const u of urls) expect(u).toContain('/persp/');
  });

  it('top과 persp는 같은 이름의 조각을 서로 다른 주소로 가리킨다', () => {
    expect(spriteUrl('snare', 'top')).not.toBe(spriteUrl('snare', 'persp'));
    expect(spriteUrl('snare')).toBe(spriteUrl('snare', 'persp'));
  });

  it('smallKitSpec 값으로 그리면 게임 200 · 악보 210 높이다', () => {
    for (const [screen, h] of [['play', 200], ['sheet', 210]] as const) {
      const { view, scale } = smallKitSpec(screen, 'acoustic');
      const html = renderToStaticMarkup(<DrumKit view={view} scale={scale} />);
      const m = /<svg[^>]*\sheight="([\d.]+)"/.exec(html);
      expect(Math.abs(Number(m?.[1]) - h)).toBeLessThan(0.5);
    }
  });

  it('전자·네온은 view를 줘도 760×300 평면 킷이다', () => {
    for (const skin of ['electronic', 'neon'] as const) {
      const plain = renderToStaticMarkup(<DrumKit skin={skin} scale={0.5} />);
      const html = renderToStaticMarkup(<DrumKit skin={skin} view="top" scale={0.5} />);
      expect(html).toBe(plain);
      expect(html).toContain('viewBox="0 0 760 300"');
      expect(count(html, /<image/g)).toBe(0);
    }
  });

  it('자유 틀(frame)은 view와 무관하게 원근 그림을 쓴다', () => {
    const frame = kitFrame(DEFAULT_KIT_LAYOUT, { w: 1000, h: 625 }, 'acoustic');
    const html = renderToStaticMarkup(<DrumKit frame={frame} view="top" />);
    expect(html).toBe(renderToStaticMarkup(<DrumKit frame={frame} />));
    expect(html).toContain('viewBox="0 0 1000 625"');
    for (const u of hrefs(html)) expect(u).toContain('/persp/');
  });

  it('하이햇 원판은 top에서 열림·닫힘 이동(--close-dy)이 없다', () => {
    const top = renderToStaticMarkup(<DrumKit view="top" hihatClosed={false} />);
    expect(top).not.toContain('--close-dy');
    expect(renderToStaticMarkup(<DrumKit hihatClosed={false} />)).toContain('--close-dy');
  });
});
