import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DifficultyChip } from './DifficultyChip';
import { SongMeta } from './SongMeta';

describe('DifficultyChip', () => {
  it.each([
    ['EASY', '쉬움', 'ui-pill-ok'],
    ['NORMAL', '보통', 'ui-pill-accent'],
    ['HARD', '어려움', 'ui-pill-amber'],
  ] as const)('%s → %s·%s', (difficulty, label, cls) => {
    const html = renderToStaticMarkup(<DifficultyChip difficulty={difficulty} />);
    expect(html).toContain(label);
    expect(html).toContain(cls);
  });

  it('className을 덧붙인다', () => {
    expect(renderToStaticMarkup(<DifficultyChip difficulty="EASY" className="extra" />)).toContain('extra');
  });
});

describe('SongMeta', () => {
  it('아티스트·BPM·길이를 " · "로 잇는다', () => {
    const html = renderToStaticMarkup(<SongMeta artist="밴드" bpm={120} durationSec={185} />);
    expect(html).toContain('밴드 · 120 BPM · 3:05');
    expect(html).toContain('class="song-meta"');
  });

  it('없는 값은 건너뛴다', () => {
    expect(renderToStaticMarkup(<SongMeta bpm={90} />)).toContain('>90 BPM<');
    expect(renderToStaticMarkup(<SongMeta artist="a" durationSec={60} />)).toContain('>a · 1:00<');
  });

  it('BPM은 반올림한다', () => {
    expect(renderToStaticMarkup(<SongMeta bpm={120.6} />)).toContain('121 BPM');
  });

  it('모두 없으면 빈 출력', () => {
    expect(renderToStaticMarkup(<SongMeta />)).toBe('');
  });

  it('className을 합친다', () => {
    expect(renderToStaticMarkup(<SongMeta bpm={100} className="extra" />)).toContain('class="song-meta extra"');
  });
});
