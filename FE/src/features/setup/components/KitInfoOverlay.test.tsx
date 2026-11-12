import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KitInfoOverlay } from './KitInfoOverlay';

const base = { name: '스네어', x: '-12', y: '45', z: '-8', radius: '24°' };

describe('KitInfoOverlay', () => {
  it('패드 이름과 X·Y·Z(cm)·판정 범위를 라벨과 함께 보여 준다', () => {
    const html = renderToStaticMarkup(<KitInfoOverlay {...base} />);
    expect(html).toContain('>스네어</h3>');
    expect(html).toContain('<dt>X<small> cm</small></dt><dd>-12</dd>');
    expect(html).toContain('<dt>Y<small> cm</small></dt><dd>45</dd>');
    expect(html).toContain('<dt>Z<small> cm</small></dt><dd>-8</dd>');
    expect(html).toContain('<dt>판정 범위</dt><dd>24°</dd>');
  });

  it('슬라이더는 넘겼을 때만 그린다', () => {
    const without = renderToStaticMarkup(<KitInfoOverlay {...base} />);
    expect(without).not.toContain('type="range"');
    const withSlider = renderToStaticMarkup(<KitInfoOverlay {...base} slider={{ value: 20, min: 15, max: 35, onChange: () => {} }} />);
    expect(withSlider).toContain('type="range"');
    expect(withSlider).toContain('min="15"');
  });

  it('corner 기본은 right이고 left·warn은 클래스로 붙는다', () => {
    expect(renderToStaticMarkup(<KitInfoOverlay {...base} />)).toContain('class="setup-kitinfo right"');
    const html = renderToStaticMarkup(<KitInfoOverlay {...base} corner="left" tone="warn" />);
    expect(html).toContain('class="setup-kitinfo left warn"');
  });

  it('children은 본문 아래에 붙는다', () => {
    const html = renderToStaticMarkup(
      <KitInfoOverlay {...base}>
        <p>추가 줄</p>
      </KitInfoOverlay>,
    );
    expect(html.indexOf('추가 줄')).toBeGreaterThan(html.indexOf('판정 범위'));
  });
});
