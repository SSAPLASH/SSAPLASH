import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayHud } from './PlayHud';

const base = { title: '별빛 산책', artist: '아티스트', level: 'NORMAL' as const, bpm: 119.6, elapsedMs: 72_000, durationMs: 195_000 };

const game = (over: Partial<{ score: number; combo: number; accuracy: number | null; level: 'EASY' | 'NORMAL' | 'HARD' }> = {}) =>
  renderToStaticMarkup(<PlayHud variant="game" {...base} score={1234567} combo={12} accuracy={98.76} {...over} />);

describe('PlayHud game', () => {
  it('제목·아티스트·BPM 칩', () => {
    const html = game();
    expect(html).toContain('별빛 산책');
    expect(html).toContain('아티스트');
    expect(html).toContain('BPM 120');
  });

  it.each([
    ['EASY', 'EASY'],
    ['NORMAL', 'NORM'],
    ['HARD', 'HARD'],
  ] as const)('연습 단계 %s는 %s 배지', (level, label) => {
    expect(game({ level })).toContain(`>${label}</span>`);
  });

  it('시간은 mm:ss / mm:ss', () => {
    expect(game()).toContain('01:12 / 03:15');
  });

  it('점수는 콤마, 정확도는 %', () => {
    const html = game();
    expect(html).toContain('<span class="play-hud-value" data-stat="score">1,234,567</span>');
    expect(html).toContain('data-stat="combo">12<');
    expect(html).toContain('data-stat="accuracy">98.8%<');
  });

  it('정확도가 null이면 "—"', () => {
    expect(game({ accuracy: null })).toContain('data-stat="accuracy">—<');
  });

  it('data-stat은 3개이고 data-focus-title이 있다', () => {
    const html = game();
    expect(html.match(/data-stat=/g)).toHaveLength(3);
    expect(html).toContain('data-focus-title');
  });

  it('일시정지 버튼이 없다(U20)', () => {
    const html = game();
    expect(html).not.toContain('<button');
    expect(html).not.toContain('일시정지');
  });

  it('진행 막대 aria 값', () => {
    expect(game()).toContain('aria-valuenow="37"');
  });
});

describe('PlayHud sheet', () => {
  const html = renderToStaticMarkup(<PlayHud variant="sheet" {...base} perfect={10} good={3} miss={1} />);

  it('PERFECT·GOOD·MISS 3개', () => {
    expect(html.match(/data-stat=/g)).toHaveLength(3);
    expect(html).toContain('data-stat="perfect">10<');
    expect(html).toContain('data-stat="good">3<');
    expect(html).toContain('data-stat="miss">1<');
    expect(html).toContain('PERFECT');
    expect(html).toContain('GOOD');
    expect(html).toContain('MISS');
  });

  it('점수·정확도 칸이 없다', () => {
    expect(html).not.toContain('data-stat="score"');
    expect(html).not.toContain('정확도');
  });
});
