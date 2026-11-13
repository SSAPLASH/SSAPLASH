// @vitest-environment happy-dom
// 결과 화면이 학습 코스 띠에 넘기는 「방금 친 결과」 표시(설계 SETUP-학습-코스-자동-넘김 U4).
// 결과 화면은 도착 직후 state를 비우므로(새로고침 때 축하가 다시 나오지 않게), 도착 때 한 번 정한 값을 계속 넘겨야 카운트다운이 꺼지지 않는다.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { savePlayLog } from '@/engine/playLog';
import { EMPTY_PREV_BEST } from '@/domain/play/bestRecord';
import { useSettings } from '@/store/settingsStore';
import { useLessons } from '@/store/lessonStore';
import { lessonsFromDto } from '@/domain/play/lesson';
import type { PlayLog } from '@/domain/play/playLog';
import { ResultPage } from './ResultPage';

vi.mock('@/runtime/playSync', () => ({
  usePlaySync: create(() => ({ states: {} })),
  usePrefetchedReport: () => undefined,
  startPlaySync: vi.fn(),
  resumePlaySync: vi.fn(),
}));
vi.mock('@/components/song/useDeletedSongIds', () => ({ useDeletedSongIds: () => new Set<number>() }));
vi.mock('@/features/result/components/LessonResultBand', () => ({
  LessonResultBand: ({ fresh }: { fresh?: boolean }) => <div data-testid="fresh">{String(fresh === true)}</div>,
}));
vi.mock('@/features/result/components/ReportEntry', () => ({ ReportEntry: () => null }));
vi.mock('@/runtime/keyboardDrum', () => ({ useKeyboardDrum: vi.fn() }));
// 스냅샷은 매번 같은 객체여야 한다(useSyncExternalStore)
const idleSnap = vi.hoisted(() => ({ phase: 'idle', beat: 0, withKick: false, totalBeats: 16, taps: 0, outcome: null, outputLatencyMs: null }));
vi.mock('@/runtime/timingCalSession', () => ({
  timingCalSession: {
    subscribe: () => () => {},
    snapshot: () => idleSnap,
    start: vi.fn(),
    cancel: vi.fn(),
  },
}));

const logOf = (over: Partial<PlayLog> = {}): PlayLog =>
  ({
    playId: 'p1',
    songId: 's1',
    title: '시험곡',
    difficulty: 'EASY',
    mode: 'RHYTHM',
    inputSource: 'pointer',
    startedAt: '2026-11-12T00:00:00.000Z',
    durationMs: 60000,
    timing: { perfectMs: 25, goodMs: 60 },
    calibrationId: null,
    chartVersionId: null,
    songNumericId: null,
    chartId: null,
    presetId: null,
    bpm: 120,
    beatsPerBar: 4,
    hits: [],
    notes: [],
    summary: { score: 0, maxScore: 0, accuracy: 0, maxCombo: 0, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0 },
    ...over,
  }) as PlayLog;

function State() {
  const l = useLocation();
  return (
    <>
      <div data-testid="state">{JSON.stringify(l.state)}</div>
      <div data-testid="where">{l.pathname + l.search}</div>
    </>
  );
}
const show = (entry: string | { pathname: string; state: unknown }, over: Partial<PlayLog> = {}) => {
  savePlayLog(logOf({ mode: 'SHEET', inputSource: 'keyboard', ...over }));
  render(
    <MemoryRouter initialEntries={[entry]}>
      <State />
      <Routes>
        <Route path="/result/:playId" element={<ResultPage />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // 저장소가 없는 환경
  }
  useSettings.setState({ timingCal: null, timingCalPrompt: 'done' });
});
afterEach(cleanup);

describe('결과 화면 → 학습 코스 띠의 fresh', () => {
  it('연주를 마치고 도착했으면, 도착 state를 비운 뒤에도 방금 친 결과로 넘긴다', async () => {
    show({ pathname: '/result/p1', state: { prevBest: EMPTY_PREV_BEST } });
    // 결과 화면이 도착 state를 비운다(기존 동작)
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('null'));
    expect(screen.getByTestId('fresh').textContent).toBe('true');
  });

  it('치기 전 최고 기록이 없던 첫 연주(prevBest null)도 방금 친 결과다', () => {
    show({ pathname: '/result/p1', state: { prevBest: null } });
    expect(screen.getByTestId('fresh').textContent).toBe('true');
  });

  it('연주 기록에서 연 옛 결과(도착 state 없음)는 아니다', () => {
    show('/result/p1');
    expect(screen.getByTestId('fresh').textContent).toBe('false');
  });
});

// 띠의 [다시 하기]를 없애고 아래 버튼 하나로 모았다(11/13). 레슨 기록이면 학습 코스 주소로 가야 창을 닫았을 때 코스 화면이 남는다
describe('결과 화면 [다시 하기]: 레슨 기록', () => {
  const lessonList = () =>
    useLessons.setState({
      status: 'ready',
      list: lessonsFromDto({
        passAccuracy: 70,
        items: [{ order: 2, course: 'INTERMEDIATE', kind: 'PLAY', songId: 7, chartId: 77, title: '중급 · 시험', summary: 's', pads: ['RIDE'], guide: true, bpm: 70, durationMs: 1000, noteCount: 4, bestAccuracy: null, passed: false, locked: false }],
      }),
    });
  afterEach(() => useLessons.getState().resetForTest());

  it('레슨 채보의 기록이면 그 코스를 유지한 학습 코스 주소로 다시 한다', () => {
    lessonList();
    show('/result/p1', { songNumericId: 7, chartId: 77 });
    fireEvent.click(screen.getByRole('button', { name: '다시 하기' }));
    expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons&course=intermediate&song=7&chart=77&start=1');
  });

  it('레슨이 아닌 곡은 지금처럼 곡·단계 주소로 다시 한다', () => {
    lessonList();
    show('/result/p1', { songNumericId: 3, chartId: 33 });
    fireEvent.click(screen.getByRole('button', { name: '다시 하기' }));
    expect(screen.getByTestId('where').textContent).not.toContain('tab=lessons');
    expect(screen.getByTestId('where').textContent).toContain('chart=33');
  });
});
