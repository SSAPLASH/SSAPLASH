// 제목 옆 재생 중 이퀄라이저 (Figma 시안 D eq)
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayingEq } from './PlayingEq';

describe('PlayingEq', () => {
  it('재생 중: 막대 3개, 「재생 중」으로 읽힌다', () => {
    const html = renderToStaticMarkup(<PlayingEq playing />);
    expect(html).toContain('class="song-eq is-playing"');
    expect(html).toContain('aria-label="재생 중"');
    expect(html.match(/song-eq-bar/g)).toHaveLength(3);
  });

  it('멈춤: 납작한 상태, 「일시정지」로 읽힌다', () => {
    const html = renderToStaticMarkup(<PlayingEq playing={false} />);
    expect(html).toContain('class="song-eq is-paused"');
    expect(html).toContain('aria-label="일시정지"');
  });
});
