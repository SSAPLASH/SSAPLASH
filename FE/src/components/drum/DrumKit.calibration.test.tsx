// DrumKit 보정용 props 검증(PLAY-004 3-9): hidden·ghost·placement·faded·appear. SSR 문자열.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrumKit } from './DrumKit';
import { DRUM_KIT_PADS, padCenter, placePad } from '@/domain/drumKit';

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('DrumKit 보정 props', () => {
  it('hidden 패드는 그리지 않는다', () => {
    const html = renderToStaticMarkup(<DrumKit hidden={['SNARE', 'RIDE']} />);
    expect(html).not.toContain('>스네어<');
    expect(html).not.toContain('>라이드<');
    expect(html).toContain('>하이햇<');
    expect(count(html, /class="drum-pad"/g)).toBe(DRUM_KIT_PADS.length - 2);
  });

  it('ghost 패드는 armed 링 + drum-pad-ghost 그룹', () => {
    const html = renderToStaticMarkup(<DrumKit ghost="SNARE" />);
    expect(html).toContain('class="drum-pad-ghost"');
    expect(html).toContain('data-state="armed"');
  });

  it('placement는 패드 헤드 중심을 그 좌표로 옮긴다', () => {
    const snare = DRUM_KIT_PADS.find((p) => p.pad === 'SNARE')!;
    const moved = placePad(snare, 0.2, 0.3);
    const html = renderToStaticMarkup(<DrumKit placement={{ SNARE: { x: 0.2, y: 0.3 } }} />);
    expect(html).toContain(`translate(${moved.left} ${moved.top})`);
    expect(padCenter(moved).x).toBeCloseTo(0.2 * 760);
  });

  it('faded·appear 그룹 클래스', () => {
    const html = renderToStaticMarkup(<DrumKit faded={['KICK']} appear />);
    expect(html).toContain('drum-pad-faded');
    expect(html).toContain('drum-pad-appear');
  });

  it('보정 props가 없으면 마크업에 그룹이 없다', () => {
    const html = renderToStaticMarkup(<DrumKit />);
    expect(html).not.toContain('drum-pad-ghost');
    expect(html).not.toContain('drum-pad-faded');
    expect(html).not.toContain('drum-pad-appear');
  });
});
