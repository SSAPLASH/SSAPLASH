// Pad 배지 마크업 테스트: 문자열 배지 호환, PadBadge level(now·next·later), 격자 밖 점
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PadBadge } from '@/domain/drumKit';
import { DrumKit, type DrumKitProps } from './DrumKit';
import { Pad, PadDefs } from './Pad';

function pad(badge?: string | PadBadge, badgeHighlight = false) {
  return renderToStaticMarkup(
    <svg>
      <Pad shape="drum" left={0} top={0} w={160} label="스네어" badge={badge} badgeHighlight={badgeHighlight} defsId="t" />
    </svg>,
  );
}

describe('Pad 배지', () => {
  it('배지가 없으면 배지 마크업이 없다', () => {
    expect(pad()).not.toContain('drum-pad-badge');
  });

  it('문자열 배지는 {text, level:next}와 같은 마크업', () => {
    const html = pad('1&');
    expect(html).toBe(pad({ text: '1&', level: 'next' }));
    expect(html).toContain('class="drum-pad-badge"');
    expect(html).toContain('class="drum-pad-badge-bg"');
    expect(html).toContain('>1&amp;</text>');
    expect(html).not.toContain('highlight');
    expect(html).not.toContain('drum-pad-badge-dot');
  });

  it('level now: 배경·글자에 highlight 클래스', () => {
    const html = pad({ text: '2', level: 'now' });
    expect(html).toContain('drum-pad-badge-bg highlight');
    expect(html).toContain('drum-pad-badge-text highlight');
    expect(html).not.toContain('drum-pad-badge later');
  });

  it('level later: 그룹에 later 클래스, 강조 없음', () => {
    const html = pad({ text: '3', level: 'later' });
    expect(html).toContain('drum-pad-badge later');
    expect(html).not.toContain('highlight');
  });

  it('badgeHighlight면 level과 무관하게 now 모양', () => {
    const html = pad({ text: '3', level: 'later' }, true);
    expect(html).toContain('drum-pad-badge-bg highlight');
    expect(html).not.toContain('drum-pad-badge later');
  });

  it('offGrid일 때만 점이 있다', () => {
    expect(pad({ text: '1', level: 'next', offGrid: true })).toContain('drum-pad-badge-dot');
    expect(pad({ text: '1', level: 'next', offGrid: false })).not.toContain('drum-pad-badge-dot');
    expect(pad({ text: '1', level: 'next' })).not.toContain('drum-pad-badge-dot');
  });
});

describe('DrumKit 배지 전달', () => {
  const kit = (props: DrumKitProps) => renderToStaticMarkup(<DrumKit {...props} />);

  it('badges 패드에만 배지가 생긴다', () => {
    const html = kit({ badges: { SNARE: '1', KICK: { text: '2e', level: 'later', offGrid: true } } });
    expect(html.match(/<g[^>]*class="drum-pad-badge/g)).toHaveLength(2);
    expect(html).toContain('drum-pad-badge later');
    expect(html.match(/drum-pad-badge-dot/g)).toHaveLength(1);
  });

  it('now 배지는 여러 개여도 각자 강조', () => {
    const html = kit({ badges: { SNARE: { text: '1', level: 'now' }, KICK: { text: '1', level: 'now' } } });
    expect(html.match(/drum-pad-badge-bg highlight/g)).toHaveLength(2);
  });

  it('highlight 패드의 배지는 now 모양', () => {
    const html = kit({ badges: { SNARE: '1', KICK: '2' }, highlight: 'SNARE' });
    expect(html.match(/drum-pad-badge-bg highlight/g)).toHaveLength(1);
  });
});

describe('Pad 질감·모션 구조', () => {
  const render = (shape: 'drum' | 'cymbal' | 'kick') =>
    renderToStaticMarkup(
      <svg>
        <Pad shape={shape} left={0} top={0} w={160} label="x" state="hit" defsId="t" />
      </svg>,
    );

  it.each(['drum', 'cymbal', 'kick'] as const)('%s는 drum-pad-body 그룹을 가진다', (shape) => {
    expect(render(shape)).toContain('class="drum-pad-body"');
  });

  it('cymbal은 원판을 drum-pad-cymbal 그룹으로 묶고 스탠드는 그 밖에 있다', () => {
    const html = render('cymbal');
    const start = html.indexOf('class="drum-pad-cymbal"');
    expect(start).toBeGreaterThan(-1);
    const standAt = html.indexOf('t-stand');
    expect(standAt).toBeGreaterThan(-1);
    expect(standAt).toBeLessThan(start);
    expect(render('drum')).not.toContain('drum-pad-cymbal');
  });

  it('PadDefs에 새 그라디언트 id가 있다', () => {
    const html = renderToStaticMarkup(
      <svg>
        <PadDefs id="t" />
      </svg>,
    );
    for (const name of ['drum-head', 'drum-rim', 'kick-rim', 'cymbal']) {
      expect(html).toContain(`id="t-${name}"`);
    }
    expect(html).toContain('<radialGradient id="t-drum-head"');
  });
});
