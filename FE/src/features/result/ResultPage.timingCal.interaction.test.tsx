// @vitest-environment happy-dom
// 결과 화면: 박자 맞추기 권유 띠(첫 권유를 건너뛴 센서 사용자에게 한 번만)와 넓힌 판정 폭 안내.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { savePlayLog } from '@/engine/playLog';
import { EMPTY_PREV_BEST } from '@/domain/play/bestRecord';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import type { ClockSkew } from '@/domain/kit/device/arrivalSkew';
import type { PlayLog } from '@/domain/play/playLog';
import { ResultPage } from './ResultPage';

vi.mock('@/runtime/playSync', () => ({
  usePlaySync: create(() => ({ states: {} })),
  usePrefetchedReport: () => undefined,
  startPlaySync: vi.fn(),
  resumePlaySync: vi.fn(),
}));
vi.mock('@/components/song/useDeletedSongIds', () => ({ useDeletedSongIds: () => new Set<number>() }));
vi.mock('@/features/result/components/LessonResultBand', () => ({ LessonResultBand: () => null }));
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

const BAND = '박자 맞추기를 하면 판정이 더 정확해져요.';
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

/** 연주를 마치고 도착한 결과 화면(연주 화면이 prevBest를 넘긴다) */
const page = (
  <MemoryRouter initialEntries={[{ pathname: '/result/p1', state: { prevBest: EMPTY_PREV_BEST } }]}>
    <Routes>
      <Route path="/result/:playId" element={<ResultPage />} />
    </Routes>
  </MemoryRouter>
);
/** 연주 기록에서 연 옛 결과(도착 state 없음) */
const oldPage = (
  <MemoryRouter initialEntries={['/result/p1']}>
    <Routes>
      <Route path="/result/:playId" element={<ResultPage />} />
    </Routes>
  </MemoryRouter>
);
const show = (log: PlayLog, el = page) => {
  localStorage.clear();
  savePlayLog(log);
  return render(el);
};

const rec = { measuredAt: 1, medianMs: -60, madMs: 8, pairs: 12, input: 'sensor' as const, outputLatencyMs: null, kick: null };

beforeEach(() => {
  useSettings.setState({ timingCal: null, timingCalPrompt: 'skipped' });
});
afterEach(() => {
  cleanup();
  useLive.setState({ clockSkew: null });
});

describe('ResultPage 박자 맞추기 권유 띠', () => {
  it('skipped + 센서 기록이면 띠가 보이고 설정이 done이 된다(화면에 머무는 동안 띠는 남는다)', () => {
    const { rerender } = show(logOf());
    expect(screen.getByText(BAND)).toBeTruthy();
    expect(useSettings.getState().timingCalPrompt).toBe('done');
    // 설정이 done으로 바뀐 뒤 다시 그려도 띠가 남는다
    rerender(page);
    expect(screen.getByText(BAND)).toBeTruthy();
  });

  it('연주 기록에서 연 옛 결과에는 띠가 없고 설정도 바뀌지 않는다', () => {
    show(logOf(), oldPage);
    expect(screen.queryByText(BAND)).toBeNull();
    expect(useSettings.getState().timingCalPrompt).toBe('skipped');
  });

  it('[박자 맞추기]를 누르면 대화상자가 뜬다', () => {
    show(logOf());
    fireEvent.click(screen.getByRole('button', { name: '박자 맞추기' }));
    expect(screen.getByRole('dialog', { name: '박자 맞추기' })).toBeTruthy();
  });

  it.each([
    ['키보드 기록', logOf({ inputSource: 'keyboard' }), { timingCalPrompt: 'skipped' as const }],
    ['none', logOf(), { timingCalPrompt: 'none' as const }],
    ['done', logOf(), { timingCalPrompt: 'done' as const }],
    ['측정 기록 있음', logOf(), { timingCal: rec }],
  ])('%s이면 띠가 없고 설정도 바뀌지 않는다', (_n, log, over) => {
    useSettings.setState(over);
    const before = useSettings.getState().timingCalPrompt;
    show(log);
    expect(screen.queryByText(BAND)).toBeNull();
    expect(useSettings.getState().timingCalPrompt).toBe(before);
  });
});

describe('ResultPage 넓힌 판정 폭 안내', () => {
  it('기록의 GOOD이 기본값보다 넓으면 한 줄을 보인다', () => {
    show(logOf({ timing: { perfectMs: 25, goodMs: 90 } }));
    expect(screen.getByText('판정 여유 ±90ms로 연주한 기록이에요')).toBeTruthy();
  });

  it('기본 폭이면 보이지 않는다', () => {
    show(logOf());
    expect(screen.queryByText(/로 연주한 기록이에요/)).toBeNull();
  });
});

describe('ResultPage 기기 시각 차이 경고 띠 (PLAY-006)', () => {
  const SKEW_TEXT = '왼손 스틱 시간이 어긋났어요. 껐다 켜 주세요.';
  const skew: ClockSkew = { spreadMs: 40, medians: { left: 50, right: 10, pedal: 10 }, outlier: 'left' };

  it('연주를 마치고 도착했을 때 경고 중이면 띠 한 줄을 보인다(버튼 없음, 화면에 머무는 동안 남는다)', () => {
    useLive.setState({ clockSkew: skew });
    const { rerender } = show(logOf());
    const band = screen.getByText(SKEW_TEXT).closest('.lesson-band') as HTMLElement;
    expect(band.getAttribute('role')).toBe('status');
    expect(band.querySelector('button')).toBeNull();
    // 경고가 끝나도 도착 시점 값을 붙잡는다
    useLive.setState({ clockSkew: null });
    rerender(page);
    expect(screen.getByText(SKEW_TEXT)).toBeTruthy();
  });

  it('경고 중이 아니면 띠가 없다', () => {
    show(logOf());
    expect(screen.queryByText(SKEW_TEXT)).toBeNull();
  });

  it('연주 기록에서 연 옛 결과에는 경고 중이어도 보이지 않는다', () => {
    useLive.setState({ clockSkew: skew });
    show(logOf(), oldPage);
    expect(screen.queryByText(SKEW_TEXT)).toBeNull();
  });
});
