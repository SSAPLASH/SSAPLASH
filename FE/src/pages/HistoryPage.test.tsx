import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPage } from './HistoryPage';

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

const render = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>,
  );

describe('HistoryPage', () => {
  it('기록이 0건이면 EmptyState', () => {
    stubLogs(null);
    const html = render();
    expect(html).toContain('아직 연주 기록이 없어요');
    expect(html).toContain('href="/play"');
    expect(html).not.toContain('전체 기록');
  });

  it('기록이 있으면 「전체 기록 n개」와 칩 3개(전체 selected)', () => {
    stubLogs([saved(1), saved(2, 'SHEET'), saved(3)]);
    const html = render();
    expect(html).toContain('전체 기록 3개');
    const chips = html.match(/<button[^>]*ui-chip[^>]*>[^<]*<\/button>/g) ?? [];
    expect(chips).toHaveLength(3);
    expect(chips[0]).toContain('aria-pressed="true"');
    expect(chips[0]).toContain('>전체<');
    expect(chips[1]).toContain('aria-pressed="false"');
    expect(chips[1]).toContain('>게임<');
    expect(chips[2]).toContain('aria-pressed="false"');
    expect(chips[2]).toContain('>악보<');
  });

  it('13건이면 첫 쪽 10행과 범위 「1–10 / 13개」', () => {
    stubLogs(Array.from({ length: 13 }, (_, i) => saved(i)));
    const html = render();
    const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    expect(body.match(/<tr/g)).toHaveLength(10);
    expect(html).toContain('1–10 / 13개');
  });
});
