// 연주 기록의 [플레이 기록 | 녹음] 탭 구조.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPage } from './HistoryPage';

vi.mock('@/store/authStore', () => ({ useAuth: (select: (s: { status: string; user: null }) => unknown) => select({ status: 'anonymous', user: null }) }));

afterEach(() => vi.unstubAllGlobals());

function stubLogs(logs: unknown[] | null) {
  const data: Record<string, string> = logs === null ? {} : { 'ssaplash.playlogs': JSON.stringify(logs) };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  });
}

const saved = {
  playId: 'p1',
  title: '곡1',
  mode: 'RHYTHM',
  startedAt: new Date(2026, 10, 1, 9, 1).toISOString(),
  songNumericId: null,
  notes: [],
  hits: [],
  summary: { score: 1000, accuracy: 0.5, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0 },
};

const render = (url: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <HistoryPage />
    </MemoryRouter>,
  );

describe('HistoryPage (녹음 기능 켬)', () => {
  it('탭 줄에 radio 2개(플레이 기록 선택), 본문은 플레이 기록', () => {
    stubLogs([saved]);
    const html = render('/history');
    const tabs = html.slice(html.indexOf('history-tabs'), html.indexOf('history-toolbar'));
    expect(tabs.match(/role="radio"/g)).toHaveLength(2);
    expect(tabs).toContain('>플레이 기록<');
    expect(tabs).toContain('>녹음<');
    expect(tabs.match(/<button[^>]*aria-checked="true"[^>]*>플레이 기록</)).not.toBeNull();
    expect(html).toContain('<strong>1</strong>개 기록');
    expect(html).not.toContain('history-tab-recordings');
  });

  it('?tab=recordings면 녹음 탭 선택과 녹음 목록(첫 조회 로딩), 플레이 기록 본문은 없다', () => {
    stubLogs([saved]);
    const html = render('/history?tab=recordings');
    expect(html).toContain('불러오는 중…');
    expect(html).toContain('aria-label="모드 필터"');
    expect(html.match(/<button[^>]*aria-checked="true"[^>]*>녹음</)).not.toBeNull();
    expect(html).not.toContain('개 기록');
  });

  it('기록이 0건이어도 탭 줄은 남고 EmptyState가 그 아래에 나온다', () => {
    stubLogs(null);
    const html = render('/history');
    expect(html).toContain('history-tabs');
    expect(html.indexOf('history-tabs')).toBeLessThan(html.indexOf('아직 연주 기록이 없어요'));
  });
});
