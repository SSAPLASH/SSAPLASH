import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECORDING_ENABLED } from '@/config/features';
import { HistoryPage } from './HistoryPage';

vi.mock('@/store/authStore', () => ({ useAuth: (select: (s: { status: string; user: null }) => unknown) => select({ status: 'anonymous', user: null }) }));

afterEach(() => vi.unstubAllGlobals());

/** node 환경에는 localStorage가 없어 메모리 스텁을 끼운다(엔진 playLog.test와 같은 방식) */
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

const saved = (i: number, mode: 'RHYTHM' | 'SHEET' = 'RHYTHM') => ({
  playId: `p${i}`,
  title: `곡${i}`,
  mode,
  startedAt: new Date(2026, 10, 1, 9, i).toISOString(),
  songNumericId: null,
  notes: [],
  hits: [],
  summary: { score: 1000, accuracy: 0.5, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0 },
});

const render = (url = '/history') =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <HistoryPage />
    </MemoryRouter>,
  );

describe('HistoryPage', () => {
  it('기록이 0건이면 EmptyState', () => {
    stubLogs(null);
    const html = render();
    expect(html).toContain('아직 연주 기록이 없어요');
    expect(html).toContain('href="/play"');
    expect(html).not.toContain('개 기록');
  });

  it('기록이 있으면 「n개 기록」과 모드 Segmented radio 3개(전체 선택)', () => {
    stubLogs([saved(1), saved(2, 'SHEET'), saved(3)]);
    const html = render();
    expect(html).toContain('<strong>3</strong>개 기록');
    expect(html).toContain('aria-label="모드 필터"');
    expect(html).not.toContain('ui-chip');
    const group = html.slice(html.indexOf('aria-label="모드 필터"'));
    const radios = group.match(/<button[^>]*role="radio"[^>]*>[^<]*<\/button>/g) ?? [];
    expect(radios.slice(0, 3)).toHaveLength(3);
    expect(radios[0]).toContain('aria-checked="true"');
    expect(radios[0]).toContain('>전체<');
    expect(radios[1]).toContain('aria-checked="false"');
    expect(radios[1]).toContain('>리듬 게임<');
    expect(radios[2]).toContain('aria-checked="false"');
    expect(radios[2]).toContain('>악보 연습<');
  });

  it('RECORDING_ENABLED 기본값은 켜짐이라 탭 줄이 있고 기본 탭은 플레이 기록이다', () => {
    expect(RECORDING_ENABLED).toBe(true);
    stubLogs([saved(1)]);
    const html = render();
    expect(html).toContain('history-tabs');
    expect(html).toContain('<strong>1</strong>개 기록');
  });

  it('검색칸과 정렬 토글이 있다', () => {
    stubLogs([saved(1)]);
    const html = render();
    expect(html).toContain('placeholder="곡 제목 검색"');
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="정렬"');
  });

  it('이 브라우저의 기록 13건은 쪽 나눔 없이 모두 행으로 보이고 표는 쓰지 않는다', () => {
    stubLogs(Array.from({ length: 13 }, (_, i) => saved(i)));
    const html = render();
    expect(html.match(/<li class="history-row"/g)).toHaveLength(13);
    expect(html).toContain('<strong>13</strong>개 기록');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('더 보기');
  });
});
