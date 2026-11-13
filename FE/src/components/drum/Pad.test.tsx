// Pad 배지 마크업 테스트: 문자열 배지 호환, PadBadge level(now·next·later), 격자 밖 점
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PadBadge } from '@/domain/kit/drumKit';
import { KIT_ART_PERSP, kitArtPad } from '@/domain/kit/kitArt';
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

describe('실물 패드(이미지) 구조', () => {
  const ART = { drum: 'SNARE', cymbal: 'CRASH', kick: 'KICK' } as const;
  const art = (shape: 'drum' | 'cymbal' | 'kick') => kitArtPad(KIT_ART_PERSP, ART[shape])!;
  const render = (shape: 'drum' | 'cymbal' | 'kick', extra: { w?: number; textSize?: number } = {}) =>
    renderToStaticMarkup(
      <svg>
        <Pad shape={shape} left={0} top={0} w={extra.w ?? 160} label="x" state="hit" art={art(shape)} textSize={extra.textSize} defsId="t" />
      </svg>,
    );

  it.each(['drum', 'cymbal', 'kick'] as const)('%s는 drum-pad-body 그룹 안에 조각 이미지를 가진다', (shape) => {
    const html = render(shape);
    expect(html).toContain('class="drum-pad-body"');
    expect(html).toContain('<image class="drum-pad-art"');
  });

  it('심벌은 원판 조각을 drum-pad-cymbal 그룹으로 묶고 스탠드 조각은 그 밖에 있다', () => {
    const html = render('cymbal');
    const group = html.indexOf('class="drum-pad-cymbal"');
    expect(group).toBeGreaterThan(-1);
    expect(html.match(/<image class="drum-pad-art"/g)).toHaveLength(2);
    expect(html.indexOf('<image class="drum-pad-art"')).toBeLessThan(group);
    expect(render('drum')).not.toContain('drum-pad-cymbal');
    expect(render('drum').match(/<image class="drum-pad-art"/g)).toHaveLength(1);
  });

  it('누름 영역과 번쩍임은 그 패드의 헤드 타원이다', () => {
    const head = art('drum').head;
    const html = render('drum');
    expect(html).toContain(`<ellipse class="drum-pad-hitarea" cx="${head.cx}" cy="${head.cy}" rx="${head.rx}" ry="${head.ry}"`);
    expect(html).toContain(`<ellipse class="drum-pad-flash" cx="${head.cx}" cy="${head.cy}" rx="${head.rx}" ry="${head.ry}"`);
    // 킥은 번쩍임이 없다
    expect(render('kick')).not.toContain('drum-pad-flash');
    expect(render('kick')).toContain('drum-pad-hitarea');
  });

  it('글자 크기: textSize를 주면 패드 크기와 무관하게 같고, 없으면 헤드 크기에 비례한다', () => {
    const label = (html: string) => /scale\(([\d.]+)\)"><text class="drum-pad-label"/.exec(html)?.[1];
    // 폭 80이면 패드 배율 0.5 → 글자 배율 2로 상쇄한다
    expect(Number(label(render('drum', { w: 80, textSize: 1 })))).toBeCloseTo(2);
    expect(Number(label(render('drum', { w: 160, textSize: 1 })))).toBeCloseTo(1);
    // 옛 그림은 헤드 가로 반지름이 79였다
    expect(Number(label(render('drum')))).toBeCloseTo(art('drum').head.rx / 79);
  });

  it('실물인데 그림 자리가 없으면 그림을 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <svg>
        <Pad shape="drum" left={0} top={0} w={160} label="x" defsId="t" />
      </svg>,
    );
    expect(html).not.toContain('<image');
    expect(html).toContain('class="drum-pad"');
  });

  it('고정 배치 킷은 조각 이미지 12장(받침 9 + 심벌 원판 3)과 라벨 9개를 그린다', () => {
    const html = renderToStaticMarkup(<DrumKit />);
    expect(html.match(/<image class="drum-pad-art"/g)).toHaveLength(12);
    expect(html.match(/class="drum-pad-label"/g)).toHaveLength(9);
    expect(html).toContain(`viewBox="0 0 ${KIT_ART_PERSP.box.w} ${KIT_ART_PERSP.box.h}"`);
  });

  it('PadDefs에는 전자 드럼 그라디언트만 남는다', () => {
    const html = renderToStaticMarkup(
      <svg>
        <PadDefs id="t" />
      </svg>,
    );
    for (const name of ['el-hoop', 'el-mesh', 'el-edge', 'el-rubber', 'el-bell', 'el-bolt']) {
      expect(html).toContain(`id="t-${name}"`);
    }
    expect(html).not.toContain('id="t-drum-head"');
  });
});
