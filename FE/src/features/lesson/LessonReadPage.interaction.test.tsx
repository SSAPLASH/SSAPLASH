// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLessons, postLessonCompletion } from '@/api/lessons';
import { hitSoundActive, resetHitSoundForTest } from './hitSound';
import type { UserMe } from '@/domain/auth';
import type { Lesson } from '@/domain/lesson';
import type { PadId } from '@/domain/pads';
import { useAuth } from '@/store/authStore';
import { useLessons } from '@/store/lessonStore';
import { useLive } from '@/store/liveStore';
import { loadChart } from '@/store/songStore';
import { LessonReadPage } from './LessonReadPage';

vi.mock('@/api/lessons', () => ({ fetchLessons: vi.fn(), postLessonCompletion: vi.fn() }));
vi.mock('@/store/songStore', async (importOriginal) => ({ ...(await importOriginal<object>()), loadChart: vi.fn() }));
vi.mock('@/components/drum/usePadStates', () => ({ usePadStates: () => ({}), usePadHitSeq: () => ({}) }));
vi.mock('@/components/drum/DrumKit', () => ({
  DrumKit: ({ states }: { states?: Record<string, string> }) => <div data-testid="kit">{Object.keys(states ?? {}).join(',')}</div>,
}));

const lesson = (order: number, over: Partial<Lesson> = {}): Lesson => ({
  order,
  kind: 'READ',
  songId: 100 + order,
  chartId: 200 + order,
  title: `알아보기 ${order}`,
  summary: '설명',
  pads: ['KICK'],
  guide: true,
  bpm: 70,
  durationMs: 3428,
  noteCount: 2,
  bestAccuracy: null,
  passed: false,
  locked: order > 1,
  ...over,
});

function chartOf(pads: PadId[]) {
  return {
    chart: {
      songId: '101', title: 't', difficulty: 'NORMAL', bpm: 70, offsetMs: 0, beatsPerBar: 4, source: 'BUILTIN', durationMs: 3428,
      notes: pads.map((pad, i) => ({ timeMs: i * 857, pad })),
    },
    assets: null,
  } as unknown as Awaited<ReturnType<typeof loadChart>>;
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function open(songId = 101) {
  render(
    <MemoryRouter initialEntries={[`/sheet/lesson/${songId}`]}>
      <Routes>
        <Route path="/sheet/lesson/:songId" element={<><LessonReadPage /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function hit(pad: PadId) {
  act(() => {
    useLive.setState((s) => ({ lastHit: { pad, velocity: 100 } as never, hitSeq: s.hitSeq + 1 }));
  });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // 저장소가 없는 환경
  }
  useLessons.getState().resetForTest();
  resetHitSoundForTest();
  useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
  vi.mocked(fetchLessons).mockReset().mockResolvedValue({ passAccuracy: 70, items: [lesson(1), lesson(2, { kind: 'PLAY' })] });
  vi.mocked(postLessonCompletion).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadChart).mockReset().mockResolvedValue(chartOf(['KICK', 'KICK']));
});
afterEach(() => {
  cleanup();
  useAuth.setState({ status: 'unknown', user: null });
});

describe('알아보기 화면', () => {
  it('지금 음표를 알려 주고 그 패드만 밝히며, 이 화면에서는 타격음이 난다', async () => {
    open();
    expect(await screen.findByText('이 음표는 킥이에요. 오른발로 밟아요.')).toBeTruthy();
    expect(screen.getByTestId('kit').textContent).toBe('KICK');
    expect(screen.getByRole('img', { name: '음표 2개 중 1번째' })).toBeTruthy();
    expect(hitSoundActive()).toBe(true);
    expect(loadChart).toHaveBeenCalledWith({ songId: 101, chartId: 201 }, expect.any(AbortSignal));
  });

  it('틀리면 넘어가지 않고, 맞으면 다음 음표로 간다. 끝까지 치면 완료를 저장하고 다음 레슨으로 갈 수 있다', async () => {
    open();
    await screen.findByRole('img', { name: '음표 2개 중 1번째' });
    hit('SNARE');
    expect(screen.getByText('다시 볼까요? 이 음표는 킥이에요. 오른발로 밟아요.')).toBeTruthy();
    expect(screen.getByRole('img', { name: '음표 2개 중 1번째' })).toBeTruthy();
    hit('KICK');
    expect(screen.getByRole('img', { name: '음표 2개 중 2번째' })).toBeTruthy();
    hit('KICK');
    // 완료는 팝업으로 뜨고, 뒤에는 방금 친 악보가 그대로 남는다
    const dialog = await screen.findByRole('dialog', { name: '레슨 완료!' });
    expect(within(dialog).getByText('음표 2개를 모두 쳤어요. 다음 스테이지가 열렸어요.')).toBeTruthy();
    expect(screen.getByRole('img', { name: /음표 2개 중/ })).toBeTruthy();
    expect(postLessonCompletion).toHaveBeenCalledWith(101);
    expect(useLessons.getState().localPassed.has(101)).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '다음 레슨' }));
    expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons&song=102&chart=202&start=1');
  });

  it('완료 팝업을 닫으면 같은 화면에 [다시 하기]·[코스로]가 남고, 다시 하면 처음 음표부터 친다', async () => {
    open();
    await screen.findByRole('img', { name: '음표 2개 중 1번째' });
    hit('KICK');
    hit('KICK');
    await screen.findByRole('dialog', { name: '레슨 완료!' });
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '다시 하기' }));
    expect(screen.getByRole('img', { name: '음표 2개 중 1번째' })).toBeTruthy();
    expect(screen.getByText('이 음표는 킥이에요. 오른발로 밟아요.')).toBeTruthy();
    // 다시 해서 끝내면 팝업이 다시 뜨지만 완료 저장은 처음 한 번만 보낸다
    hit('KICK');
    hit('KICK');
    expect(await screen.findByRole('dialog', { name: '레슨 완료!' })).toBeTruthy();
    expect(postLessonCompletion).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '코스로' }));
    expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons');
  });

  it('guide가 꺼진 레슨은 틀리기 전에는 답을 알려 주지 않는다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue({ passAccuracy: 70, items: [lesson(1, { guide: false, pads: ['KICK', 'SNARE'] })] });
    vi.mocked(loadChart).mockResolvedValue(chartOf(['SNARE', 'KICK']));
    open();
    expect(await screen.findByText('이 음표는 어느 드럼일까요? 맞는 드럼을 쳐 보세요.')).toBeTruthy();
    expect(screen.getByTestId('kit').textContent).toBe('');
    hit('KICK');
    expect(screen.getByText('다시 볼까요? 이 음표는 스네어예요. 왼손으로 쳐요.')).toBeTruthy();
    expect(screen.getByTestId('kit').textContent).toBe('SNARE');
  });

  it('완료 저장이 실패해도 이번 접속에서는 통과로 두고 다시 저장할 수 있다', async () => {
    vi.mocked(postLessonCompletion).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    open();
    await screen.findByRole('img', { name: '음표 2개 중 1번째' });
    hit('KICK');
    hit('KICK');
    fireEvent.click(await screen.findByRole('button', { name: '다시 저장' }));
    await waitFor(() => expect(postLessonCompletion).toHaveBeenCalledTimes(2));
    expect(useLessons.getState().localPassed.has(101)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: '다시 저장' })).toBeNull());
  });

  it('알아보기 레슨이 아니거나 없으면 안내하고 코스로 돌아갈 수 있다', async () => {
    open(102);
    expect(await screen.findByText('레슨을 찾을 수 없어요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '입문 코스로' }));
    expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons');
  });

  it('떠나면 타격음 스위치를 끈다', async () => {
    open();
    await screen.findByRole('img', { name: '음표 2개 중 1번째' });
    cleanup();
    expect(hitSoundActive()).toBe(false);
  });
});
