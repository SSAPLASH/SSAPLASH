// RECORDING_ENABLED를 끈 경우(VITE_RECORDING=false 빌드): 탭 줄이 없고 ?tab=recordings도 무시한다. 기능 스위치는 빌드 상수라 모듈을 모의해 끈다.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPage } from './HistoryPage';

vi.mock('@/store/authStore', () => ({ useAuth: (select: (s: { status: string; user: null }) => unknown) => select({ status: 'anonymous', user: null }) }));

vi.mock('@/config/features', () => ({ RECORDING_ENABLED: false, SONG_EDIT_ENABLED: true }));

afterEach(() => vi.unstubAllGlobals());

function stubLogs(logs: unknown[]) {
  const data: Record<string, string> = { 'ssaplash.playlogs': JSON.stringify(logs) };
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

const log = {
  playId: 'p1',
  title: '곡1',
  mode: 'RHYTHM',
  startedAt: new Date(2026, 10, 1, 9, 0).toISOString(),
  songNumericId: null,
  notes: [],
  hits: [],
  summary: { score: 1000, accuracy: 0.5, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0 },
};

const render = (path = '/history') =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <HistoryPage />
    </MemoryRouter>,
  );

describe('HistoryPage (녹음 스위치 꺼짐)', () => {
  it('탭 줄이 없고 ?tab=recordings도 무시한다', () => {
    stubLogs([log]);
    expect(render()).not.toContain('history-tabs');
    const html = render('/history?tab=recordings');
    expect(html).not.toContain('history-tabs');
    expect(html).not.toContain('불러오는 중');
    expect(html).toContain('<strong>1</strong>개 기록');
  });
});
