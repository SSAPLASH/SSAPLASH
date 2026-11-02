import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LevelBadge } from './LevelBadge';
import { SongMeta } from './SongMeta';

describe('LevelBadge', () => {
  it.each([
    ['EASY', 'EASY', 'song-level-easy'],
    ['NORMAL', 'NORM', 'song-level-normal'],
    ['HARD', 'HARD', 'song-level-hard'],
  ] as const)('%s → %s·%s', (level, label, cls) => {
    const html = renderToStaticMarkup(<LevelBadge level={level} />);
    expect(html).toContain(`>${label}<`);
    expect(html).toContain(cls);
    expect(html).toMatch(/^<span/);
  });

  it('onClick이 있으면 버튼이고 선택되지 않으면 흐리다', () => {
    const off = renderToStaticMarkup(<LevelBadge level="EASY" onClick={() => {}} />);
    expect(off).toMatch(/^<button/);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('song-level-dim');
    const on = renderToStaticMarkup(<LevelBadge level="EASY" selected onClick={() => {}} />);
    expect(on).toContain('aria-pressed="true"');
    expect(on).not.toContain('song-level-dim');
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
