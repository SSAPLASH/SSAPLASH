// DrumKit coachPad prop 테스트(SSR 문자열): 코칭 대상 패드에만 링을 그린다
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrumKit } from './DrumKit';

describe('DrumKit coachPad', () => {
  it('기본은 코칭 링이 없다', () => {
    expect(renderToStaticMarkup(<DrumKit />)).not.toContain('drum-pad-coach');
  });
  it('coachPad를 주면 그 패드에만 링이 하나 있다', () => {
    const html = renderToStaticMarkup(<DrumKit coachPad="SNARE" />);
    expect(html.match(/drum-pad-coach/g)).toHaveLength(1);
    expect(html).toContain('data-coach-pad="SNARE"');
  });
  it('이펙트가 켜져 있어도 링이 그려진다', () => {
    expect(renderToStaticMarkup(<DrumKit effects coachPad="SMALL_TOM" />)).toContain('data-coach-pad="SMALL_TOM"');
  });
});
