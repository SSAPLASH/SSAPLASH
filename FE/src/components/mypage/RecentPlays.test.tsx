import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RecentPlays, type RecentPlayItem } from './RecentPlays';

const item = (over: Partial<RecentPlayItem> = {}): RecentPlayItem => ({
  playId: 'p1',
  title: '별빛 산책',
  mode: 'RHYTHM',
  difficulty: 'NORMAL',
  startedAt: '2026-10-29T01:00:00Z',
  accuracy: 0.9,
  ...over,
});

function render(items: RecentPlayItem[]): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RecentPlays items={items} />
    </MemoryRouter>,
  );
}

describe('RecentPlays 삭제된 곡 (CHART-001 U9·U11)', () => {
  it('삭제된 곡은 제목을 그대로 두고 옆에 "삭제된 곡"을 붙이며 결과 링크는 유지한다', () => {
    const html = render([item({ deleted: true })]);
    expect(html).toContain('별빛 산책');
    expect(html).toContain('삭제된 곡');
    expect(html).toContain('href="/result/p1"');
  });

  it('삭제가 확인되지 않은 기록에는 표시하지 않는다', () => {
    expect(render([item(), item({ playId: 'p2', deleted: false })])).not.toContain('삭제된 곡');
  });
});
