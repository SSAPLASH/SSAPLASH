import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayLogTab } from './PlayLogTab';

vi.mock('@/store/authStore', () => ({ useAuth: (select: (s: { status: string; user: null }) => unknown) => select({ status: 'anonymous', user: null }) }));

afterEach(() => vi.unstubAllGlobals());

/** node 환경에는 localStorage가 없어 메모리 스텁을 끼운다(HistoryPage.test와 같은 방식) */
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

const saved = (id: string, title: string, minute: number) => ({
  playId: id,
  title,
  mode: 'RHYTHM',
  startedAt: new Date(2026, 10, 1, 9, minute).toISOString(),
  songNumericId: null,
  notes: [],
  hits: [],
  summary: { score: 1000, accuracy: 0.5, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0 },
});

const render = (props: ComponentProps<typeof PlayLogTab> = {}) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <PlayLogTab {...props} />
    </MemoryRouter>,
  );

const bodyRows = (html: string) => html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>')).match(/<tr/g) ?? [];

describe('PlayLogTab', () => {
  it('기본은 최신순이라 첫 행이 가장 최근 기록', () => {
    stubLogs([saved('a', '오래된곡', 1), saved('b', '최근곡', 30), saved('c', '중간곡', 10)]);
    const html = render();
    const body = html.slice(html.indexOf('<tbody'));
    expect(body.indexOf('최근곡')).toBeLessThan(body.indexOf('중간곡'));
    expect(body.indexOf('중간곡')).toBeLessThan(body.indexOf('오래된곡'));
  });

  it('로그가 0건이면 EmptyState와 [리듬 게임 시작]만 그린다', () => {
    stubLogs(null);
    const html = render();
    expect(html).toContain('아직 연주 기록이 없어요');
    expect(html).toContain('href="/play"');
    expect(html).not.toContain('전체 기록');
    expect(html).not.toContain('placeholder="곡 제목 검색"');
  });

  it('검색어가 비어 있으면 모든 행, 검색칸·정렬 토글을 그린다', () => {
    stubLogs([saved('a', 'Alpha', 1), saved('b', 'Beta', 2)]);
    const html = render();
    expect(bodyRows(html)).toHaveLength(2);
    expect(html).toContain('placeholder="곡 제목 검색"');
    expect(html).toContain('aria-label="정렬"');
    expect(html).toContain('>최신<');
    expect(html).toContain('>오래된<');
    expect(html).not.toContain('조건에 맞는 기록이 없어요');
  });

  it('검색어로 행 수가 줄고 개수 문구도 따라간다(대소문자 무시)', () => {
    stubLogs([saved('a', 'Alpha', 1), saved('b', 'Beta', 2), saved('c', 'alphabet', 3)]);
    const html = render({ initialQuery: ' ALPHA ' });
    expect(bodyRows(html)).toHaveLength(2);
    expect(html).toContain('전체 기록 2개');
    expect(html).not.toContain('Beta');
  });

  it('정렬 OLDEST면 첫 행이 가장 오래된 기록', () => {
    stubLogs([saved('a', '오래된곡', 1), saved('b', '최근곡', 30), saved('c', '중간곡', 10)]);
    const body = render({ initialSort: 'OLDEST' });
    const rows = body.slice(body.indexOf('<tbody'));
    expect(rows.indexOf('오래된곡')).toBeLessThan(rows.indexOf('중간곡'));
    expect(rows.indexOf('중간곡')).toBeLessThan(rows.indexOf('최근곡'));
  });

  it('검색 결과가 0건이면 「조건에 맞는 기록이 없어요」, 표와 페이지 탐색은 없다', () => {
    stubLogs([saved('a', 'Alpha', 1)]);
    const html = render({ initialQuery: 'zzz' });
    expect(html).toContain('조건에 맞는 기록이 없어요');
    expect(html).toContain('전체 기록 0개');
    expect(html).not.toContain('<tbody');
    expect(html).not.toContain('history-pager');
    expect(html).toContain('placeholder="곡 제목 검색"');
  });
});
