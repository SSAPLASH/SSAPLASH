// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLessons, postLessonCompletion } from '@/api/play/lessons';
import { hitSoundActive, resetHitSoundForTest } from '@/runtime/hitSound';
import { keyboardSource } from '@/runtime/sources';
import type { UserMe } from '@/domain/account/auth';
import type { StickEvent } from '@/domain/events';
import type { Lesson } from '@/domain/play/lesson';
import type { PadId } from '@/domain/kit/pads';
import { useAuth } from '@/store/authStore';
import { useLessons } from '@/store/lessonStore';
import { useLive } from '@/store/liveStore';
import { loadChart } from '@/store/songStore';
import { LessonReadPage } from './LessonReadPage';

vi.mock('@/api/play/lessons', () => ({ fetchLessons: vi.fn(), postLessonCompletion: vi.fn() }));
vi.mock('@/store/songStore', async (importOriginal) => ({ ...(await importOriginal<object>()), loadChart: vi.fn() }));
vi.mock('@/components/drum/usePadStates', () => ({ usePadStates: () => ({}), usePadHitSeq: () => ({}) }));
vi.mock('@/components/drum/DrumKit', () => ({
  DrumKit: ({ states }: { states?: Record<string, string> }) => <div data-testid="kit">{Object.keys(states ?? {}).join(',')}</div>,
}));

const lesson = (order: number, over: Partial<Lesson> = {}): Lesson => ({
  order,
  course: 'BEGINNER',
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
    // 다음 레슨이 같은 코스라 카운트다운이 돈다. [지금 가기]는 자동 시작 주소로 간다
    expect(within(dialog).getByText('3초 뒤 다음 레슨으로 넘어가요.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '지금 가기' }));
    expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons&course=beginner&song=102&chart=202&start=1&auto=1');
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
    expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons&course=beginner');
  });

  // 학습 코스 설계 3-6·4-3절: 화면 이름과 돌아가는 곳은 그 레슨의 코스다
  it('중급 알아보기 레슨은 「← 중급 코스」이고 코스로 가면 중급 코스가 보인다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue({
      passAccuracy: 70,
      items: [lesson(1, { passed: true }), lesson(1, { course: 'INTERMEDIATE', songId: 301, chartId: 401, title: '중급 · 탐 음표 알아보기' })],
    });
    open(301);
    expect(await screen.findByRole('heading', { name: '1. 탐 음표 알아보기' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← 중급 코스' }));
    expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons&course=intermediate');
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
    fireEvent.click(screen.getByRole('button', { name: '학습 코스로' }));
    expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons');
  });

  // 설계 SETUP-학습-코스-자동-넘김 4-2
  describe('완료 팝업의 자동 넘김', () => {
    const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    const finish = async () => {
      open();
      await screen.findByRole('img', { name: '음표 2개 중 1번째' });
      hit('KICK');
      hit('KICK');
      return screen.findByRole('dialog', { name: '레슨 완료!' });
    };
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('3초 뒤 다음 레슨으로 넘어간다', async () => {
      const dialog = await finish();
      expect(within(dialog).getByText('3초 뒤 다음 레슨으로 넘어가요.')).toBeTruthy();
      await pass(3000);
      expect(screen.getByTestId('where').textContent).toBe('/sheet?tab=lessons&course=beginner&song=102&chart=202&start=1&auto=1');
    });

    it('[머무르기]면 멈추고 [다음 레슨]이 남는다. 팝업을 닫아도 멈춘다', async () => {
      const dialog = await finish();
      fireEvent.click(within(dialog).getByRole('button', { name: '머무르기' }));
      expect(within(dialog).queryByText(/초 뒤 다음 레슨/)).toBeNull();
      expect(within(dialog).getByRole('button', { name: '다음 레슨' })).toBeTruthy();
      await pass(5000);
      expect(screen.getByTestId('where').textContent).toBe('/sheet/lesson/101');
      cleanup();
      await finish();
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      await pass(5000);
      expect(screen.getByTestId('where').textContent).toBe('/sheet/lesson/101');
    });

    it('완료 저장이 실패해 있으면 세지 않는다', async () => {
      vi.mocked(postLessonCompletion).mockRejectedValue(new Error('offline'));
      const dialog = await finish();
      await within(dialog).findByRole('button', { name: '다시 저장' });
      expect(within(dialog).queryByText(/초 뒤 다음 레슨/)).toBeNull();
      await pass(5000);
      expect(screen.getByTestId('where').textContent).toBe('/sheet/lesson/101');
    });

    it('코스의 마지막 레슨이면 세지 않는다', async () => {
      vi.mocked(fetchLessons).mockResolvedValue({ passAccuracy: 70, items: [lesson(1)] });
      const dialog = await finish();
      expect(within(dialog).queryByText(/초 뒤 다음 레슨/)).toBeNull();
    });
  });

  it('떠나면 타격음 스위치를 끈다', async () => {
    open();
    await screen.findByRole('img', { name: '음표 2개 중 1번째' });
    cleanup();
    expect(hitSoundActive()).toBe(false);
  });

  it('이 화면에 있는 동안 키보드 드럼을 받고, 떠나면 다시 받지 않는다', async () => {
    // 키보드 드럼은 화면이 직접 켜야 받는다(352). 알아보기 화면도 연주 화면처럼 켠다
    const keyHits: StickEvent[] = [];
    keyboardSource.setKeys(['KeyJ']);
    const unsub = keyboardSource.subscribe((e) => {
      if (e.kind === 'hit') keyHits.push(e);
    });
    await keyboardSource.connect();
    try {
      open();
      await screen.findByRole('img', { name: '음표 2개 중 1번째' });
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', cancelable: true }));
      expect(keyHits).toHaveLength(1);
      cleanup();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', cancelable: true }));
      expect(keyHits).toHaveLength(1);
    } finally {
      unsub();
      await keyboardSource.disconnect();
    }
  });
});
