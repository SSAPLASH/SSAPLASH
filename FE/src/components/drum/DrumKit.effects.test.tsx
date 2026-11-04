// DrumKit effects prop 기본값 테스트(SSR 문자열)
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrumKit } from './DrumKit';

describe('DrumKit effects', () => {
  it('기본은 hit-effects 레이어가 없다', () => {
    expect(renderToStaticMarkup(<DrumKit />)).not.toContain('hit-effects');
  });
  it('effects를 켜면 레이어가 있다', () => {
    // useReducedMotion은 SSR에서 false라 레이어를 그린다
    expect(renderToStaticMarkup(<DrumKit effects />)).toContain('hit-effects');
  });
});
