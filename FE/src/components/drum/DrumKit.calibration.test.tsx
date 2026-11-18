// DrumKit 보정용 props 검증(PLAY-004 3-9): hidden·ghost·placement·faded·appear. SSR 문자열.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrumKit } from './DrumKit';
import { DRUM_KIT_PADS, kitBoxFor, padCenter, placePad } from '@/domain/kit/drumKit';

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
    const boxH = kitBoxFor('acoustic').h;
    const moved = placePad(snare, 0.2, 0.3, boxH);
    const html = renderToStaticMarkup(<DrumKit placement={{ SNARE: { x: 0.2, y: 0.3 } }} />);
    expect(html).toContain(`translate(${moved.left} ${moved.top})`);
    expect(padCenter(moved).x).toBeCloseTo(0.2 * 760);
    expect(padCenter(moved).y).toBeCloseTo(0.3 * boxH);
  });

  it('faded·appear 그룹 클래스', () => {
    const html = renderToStaticMarkup(<DrumKit faded={['KICK']} appear />);
    expect(html).toContain('drum-pad-faded');
    expect(html).toContain('drum-pad-appear');
  });

  it('dimAll·lit(UX-64): lit 패드만 drum-pad-lit, 나머지는 전부 drum-pad-dim', () => {
    const html = renderToStaticMarkup(<DrumKit dimAll lit="HIHAT" />);
    // 심벌(하이햇)은 받침 층과 원판 층 두 그룹에 같은 클래스가 붙는다
    const cymbals = DRUM_KIT_PADS.filter((p) => p.shape === 'cymbal').length;
    expect(count(html, /drum-pad-lit/g)).toBe(2);
    expect(count(html, /drum-pad-dim/g)).toBe(DRUM_KIT_PADS.length - 1 + (cymbals - 1));
    // lit 그룹 안의 첫 라벨이 하이햇이다(다음 패드 그룹(dim)보다 앞)
    const after = html.slice(html.lastIndexOf('class="drum-pad-lit"'));
    const nextDim = after.indexOf('drum-pad-dim');
    expect(after.indexOf('>하이햇<')).toBeLessThan(nextDim === -1 ? Infinity : nextDim);
  });

  it('보정 props가 없으면 마크업에 그룹이 없다', () => {
    const html = renderToStaticMarkup(<DrumKit />);
    expect(html).not.toContain('drum-pad-ghost');
    expect(html).not.toContain('drum-pad-faded');
    expect(html).not.toContain('drum-pad-appear');
    expect(html).not.toContain('drum-pad-dim');
  });

  it('warnPads는 --warn 링, selectedPad는 선택 링을 그린다(클릭을 가로채지 않는 별도 그룹)', () => {
    const html = renderToStaticMarkup(<DrumKit warnPads={['HIHAT', 'CRASH']} selectedPad="HIHAT" />);
    expect(count(html, /class="drum-pad-warn"/g)).toBe(2);
    expect(html).toContain('data-warn-pad="HIHAT"');
    expect(html).toContain('data-warn-pad="CRASH"');
    expect(count(html, /class="drum-pad-selected"/g)).toBe(1);
    expect(html).toContain('data-selected-pad="HIHAT"');
    expect(renderToStaticMarkup(<DrumKit />)).not.toContain('drum-pad-warn');
  });
});
