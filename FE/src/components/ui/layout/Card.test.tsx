import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';
import { Chip } from './Chip';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { StatusPill } from '@/components/ui/feedback/StatusPill';

describe('Card', () => {
  it('기본은 md 패딩이고 motion-lift가 없다', () => {
    const html = renderToStaticMarkup(<Card>본문</Card>);
    expect(html).toContain('ui-card-md');
    expect(html).not.toContain('motion-lift');
    expect(html).not.toContain('<h3');
  });

  it('lg 패딩', () => {
    expect(renderToStaticMarkup(<Card padding="lg">x</Card>)).toContain('ui-card-lg');
  });

  it('clickable이면 motion-lift', () => {
    const html = renderToStaticMarkup(<Card clickable>x</Card>);
    expect(html).toContain('ui-card-clickable');
    expect(html).toContain('motion-lift');
  });

  it('title은 h3로 본문 앞에 나온다', () => {
    const html = renderToStaticMarkup(<Card title="제목">본문</Card>);
    expect(html).toContain('<h3 class="ui-card-title">제목</h3>');
    expect(html.indexOf('제목')).toBeLessThan(html.indexOf('본문'));
  });
});

describe('Chip', () => {
  it('selected ↔ aria-pressed', () => {
    const on = renderToStaticMarkup(<Chip selected>쉬움</Chip>);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toMatch(/class="[^"]*\bselected\b/);
    const off = renderToStaticMarkup(<Chip>쉬움</Chip>);
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toMatch(/\bselected\b/);
    expect(off).toContain('type="button"');
  });
});

describe('StatusPill', () => {
  it('기본은 neutral', () => {
    expect(renderToStaticMarkup(<StatusPill>x</StatusPill>)).toContain('ui-pill-neutral');
  });

  it.each(['ok', 'accent', 'neutral', 'amber'] as const)('variant %s', (v) => {
    const html = renderToStaticMarkup(<StatusPill variant={v}>글자</StatusPill>);
    expect(html).toContain(`ui-pill-${v}`);
    expect(html).toContain('<span class="ui-pill-dot" aria-hidden="true"></span>글자');
  });
});

describe('EmptyState', () => {
  it('title만 있으면 설명·행동·아이콘이 없다', () => {
    const html = renderToStaticMarkup(<EmptyState title="비었어요" />);
    expect(html).toContain('<h3 class="ui-empty-title">비었어요</h3>');
    expect(html).not.toContain('ui-empty-desc');
    expect(html).not.toContain('ui-empty-action');
    expect(html).not.toContain('ui-empty-icon');
  });

  it('description·action·icon 슬롯', () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={<i>I</i>} title="t" description="설명" action={<button>추가</button>} />,
    );
    expect(html).toContain('<p class="ui-empty-desc">설명</p>');
    expect(html).toContain('<div class="ui-empty-action"><button>추가</button></div>');
    expect(html).toContain('<div class="ui-empty-icon" aria-hidden="true"><i>I</i></div>');
  });
});
