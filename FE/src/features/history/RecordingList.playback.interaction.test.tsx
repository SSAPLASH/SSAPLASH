// @vitest-environment happy-dom
// 녹음 보관함 재생 흐름 (설계 COACH-연주-기록-화면-개편, 338 녹음 재생바): 재생 → 일시정지 → 이어 재생, 재생바로 위치 옮기기, 다른 행 재생.
// 재생기는 상태만 흉내 내는 가짜로 바꾼다(소리·타이머 없음). 재생기 자체는 features/history/recordingPlayer.test.ts가 본다.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecording, listRecordings } from '@/api/play/recordings';
import type { RecordingDetail, RecordingSummary } from '@/domain/play/recording';
import { recordingRowLabel } from '@/domain/play/recordingView';
import { queryClient } from '@/runtime/queryClient';
import { RecordingList } from './RecordingList';

const fake = vi.hoisted(() => {
  type Event = { playing: boolean; reason: string };
  const listeners = new Set<(e: Event) => void>();
  /** hold: 있으면 play가 이 약속이 풀릴 때까지 기다린다(오디오 준비 대기 흉내) */
  const state = { playing: false, paused: false, pos: 0, hold: null as Promise<void> | null };
  const emit = (e: Event) => [...listeners].forEach((l) => l(e));
  const player = {
    get playing() {
      return state.playing;
    },
    get paused() {
      return state.paused;
    },
    get active() {
      return state.playing || state.paused;
    },
    onState: (l: (e: Event) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    positionMs: () => state.pos,
    play: vi.fn(async () => {
      if (state.hold) await state.hold;
      state.playing = true;
      state.paused = false;
      state.pos = 0;
      emit({ playing: true, reason: 'start' });
    }),
    pause: vi.fn(() => {
      if (!state.playing) return;
      state.playing = false;
      state.paused = true;
      emit({ playing: false, reason: 'pause' });
    }),
    resume: vi.fn(async () => {
      if (!state.paused) return;
      state.paused = false;
      state.playing = true;
      emit({ playing: true, reason: 'resume' });
    }),
    seek: vi.fn((ms: number) => {
      state.pos = ms;
    }),
    stop: vi.fn(() => {
      if (!state.playing && !state.paused) return;
      state.playing = false;
      state.paused = false;
      state.pos = 0;
      emit({ playing: false, reason: 'stop' });
    }),
  };
  return { state, player, emit, listeners };
});

vi.mock('@/api/play/recordings');
// 행을 그릴 때마다 한 번 불리는 함수를 감싸 행별 그리기 횟수를 센다(동작은 그대로)
vi.mock('@/domain/play/recordingView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/play/recordingView')>();
  return { ...actual, recordingRowLabel: vi.fn(actual.recordingRowLabel) };
});
vi.mock('./recordingPlayer', () => ({ recordingPlayer: fake.player }));

const summary = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  id: 1,
  clientKey: 'k1',
  title: '내 연주',
  mode: 'FREE',
  inputSource: 'KEYBOARD',
  playId: null,
  hitCount: 2,
  durationMs: 60_000,
  startedAt: '2026-11-03T05:05:00Z',
  createdAt: '2026-11-03T05:06:00Z',
  updatedAt: '2026-11-03T05:06:00Z',
  song: null,
  ...over,
});

const detail = (over: Partial<RecordingSummary> = {}): RecordingDetail => ({
  ...summary(over),
  timing: null,
  hits: [
    { tMs: 100, pad: 'KICK', velocity: 100 },
    { tMs: 600, pad: 'SNARE', velocity: 90 },
  ],
});

const setList = (...items: RecordingSummary[]) =>
  vi.mocked(listRecordings).mockResolvedValue({ items, total: items.length, page: 0, size: 20, hasNext: false } as never);

const rows = () => screen.getAllByRole('listitem');
/** 그 행의 가운데 버튼(재생 또는 일시정지) */
const rowButton = (row: HTMLElement, kind: '재생' | '일시정지') => row.querySelector(`button[aria-label$="녹음 ${kind}"]`) as HTMLElement;
const PLAY = /녹음 재생$/;
const PAUSE = /녹음 일시정지$/;
const slider = () => screen.getByRole('slider', { name: '녹음 위치' }) as HTMLInputElement;

beforeEach(() => {
  queryClient.clear();
  vi.mocked(listRecordings).mockReset();
  vi.mocked(getRecording).mockReset();
  fake.state.playing = false;
  fake.state.paused = false;
  fake.state.pos = 0;
  fake.state.hold = null;
  fake.listeners.clear();
  for (const fn of [fake.player.play, fake.player.pause, fake.player.resume, fake.player.seek, fake.player.stop]) fn.mockClear();
});
afterEach(cleanup);

async function startFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: PLAY }));
  await screen.findByRole('slider', { name: '녹음 위치' });
}

describe('RecordingList 재생바', () => {
  it('재생하면 그 행에 재생바가 생기고 버튼이 「일시정지」가 된다', async () => {
    setList(summary());
    vi.mocked(getRecording).mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<RecordingList />);
    await startFirst(user);
    expect(fake.player.play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: PAUSE })).toBeTruthy();
  });

  it('처음 재생: 상세를 받고 소리가 준비될 때까지 계속 「불러오는 중」 상태이고, 그 사이 쉬는 모양으로 되돌아가 깜빡이지 않는다', async () => {
    setList(summary());
    let releaseDetail: (d: RecordingDetail) => void = () => {};
    vi.mocked(getRecording).mockImplementation(() => new Promise<RecordingDetail>((r) => (releaseDetail = r)));
    let releasePlay: () => void = () => {};
    fake.state.hold = new Promise<void>((r) => (releasePlay = r));
    const user = userEvent.setup();
    render(<RecordingList />);
    await user.click(await screen.findByRole('button', { name: PLAY }));
    const phase = () => document.querySelector('.rec-playbar')?.getAttribute('data-phase');
    await waitFor(() => expect(phase()).toBe('loading'));
    // 불러오는 동안에도 막대 아래 시간 글자는 그대로다(문구로 바뀌지 않는다)
    const bar = document.querySelector('.rec-playbar') as HTMLElement;
    expect(bar.textContent).toContain('-1:00');
    expect(bar.textContent).not.toContain('불러오는 중');

    // 상세는 왔지만 오디오 준비를 기다리는 중: 아직 불러오는 중이어야 한다
    await act(async () => {
      releaseDetail(detail());
    });
    await waitFor(() => expect(fake.player.play).toHaveBeenCalledTimes(1));
    expect(phase()).toBe('loading');

    await act(async () => {
      releasePlay();
    });
    await waitFor(() => expect(phase()).toBe('playing'));
  });

  it('불러오는 중에 같은 행을 다시 눌러도 한 번만 재생을 시작한다', async () => {
    setList(summary());
    vi.mocked(getRecording).mockResolvedValue(detail());
    let releasePlay: () => void = () => {};
    fake.state.hold = new Promise<void>((r) => (releasePlay = r));
    const user = userEvent.setup();
    render(<RecordingList />);
    await user.click(await screen.findByRole('button', { name: PLAY }));
    await waitFor(() => expect(fake.player.play).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: PLAY }));
    expect(fake.player.play).toHaveBeenCalledTimes(1);
    expect(getRecording).toHaveBeenCalledTimes(1);
    await act(async () => {
      releasePlay();
    });
    await screen.findByRole('slider', { name: '녹음 위치' });
  });

  it('재생 위치가 바뀔 때 재생 대상 행만 다시 그린다(다른 행은 그대로) — 재생 중 매 프레임 목록 전체를 그리면 화면이 끊긴다', async () => {
    setList(summary(), summary({ id: 2, title: '둘째 녹음' }), summary({ id: 3, title: '셋째 녹음' }));
    vi.mocked(getRecording).mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<RecordingList />);
    await screen.findByText('셋째 녹음');
    await user.click(rowButton(rows()[0], '재생'));
    await screen.findByRole('slider', { name: '녹음 위치' });
    await waitFor(() => expect(document.querySelector('.rec-playbar')?.getAttribute('aria-busy')).toBeNull());

    const draws = (id: number) => vi.mocked(recordingRowLabel).mock.calls.filter(([item]) => (item as RecordingSummary).id === id).length;
    const before = { 1: draws(1), 2: draws(2), 3: draws(3) };
    // 재생이 진행된다: 위치가 여러 번 바뀐다
    for (const pos of [1000, 2000, 3000]) {
      fake.state.pos = pos;
      await waitFor(() => expect(slider().value).toBe(String(pos)));
    }
    expect(draws(1)).toBeGreaterThan(before[1]);
    expect(draws(2)).toBe(before[2]);
    expect(draws(3)).toBe(before[3]);
  });

  it('일시정지는 정지가 아니다: 재생바가 남고, 다시 누르면 처음부터가 아니라 이어 재생한다', async () => {
    setList(summary());
    vi.mocked(getRecording).mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<RecordingList />);
    await startFirst(user);

    fake.state.pos = 12_000;
    await user.click(screen.getByRole('button', { name: PAUSE }));
    expect(fake.player.pause).toHaveBeenCalledTimes(1);
    expect(fake.player.stop).not.toHaveBeenCalled();
    expect(slider().value).toBe('12000');
    expect(screen.queryByRole('button', { name: PAUSE })).toBeNull();

    await user.click(screen.getByRole('button', { name: PLAY }));
    expect(fake.player.resume).toHaveBeenCalledTimes(1);
    expect(fake.player.play).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: PAUSE })).toBeTruthy();
  });

  it('재생바로 위치를 옮기면 재생기에 전하고 막대가 그 위치를 보인다(일시정지 중에도)', async () => {
    setList(summary());
    vi.mocked(getRecording).mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<RecordingList />);
    await startFirst(user);
    await user.click(screen.getByRole('button', { name: PAUSE }));

    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(fake.player.seek).toHaveBeenLastCalledWith(5000);
    await waitFor(() => expect(slider().value).toBe('5000'));
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(fake.player.seek).toHaveBeenLastCalledWith(60_000);
  });

  it('다른 행을 재생하면 재생바가 그 행으로 옮겨 간다', async () => {
    setList(summary(), summary({ id: 2, title: '다른 녹음' }));
    vi.mocked(getRecording).mockImplementation(async (id: number) => detail({ id, title: id === 2 ? '다른 녹음' : '내 연주' }));
    const user = userEvent.setup();
    render(<RecordingList />);
    await screen.findByText('다른 녹음');
    await user.click(rowButton(rows()[0], '재생'));
    await screen.findByRole('slider', { name: '녹음 위치' });
    await user.click(rowButton(rows()[0], '일시정지'));

    await user.click(rowButton(rows()[1], '재생'));
    await waitFor(() => expect(fake.player.play).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rows()[1].querySelector('input[type="range"]')).toBeTruthy());
    expect(rows()[0].querySelector('input[type="range"]')).toBeNull();
    expect(screen.getAllByRole('slider', { name: '녹음 위치' })).toHaveLength(1);
  });

  it('10초 앞으로·뒤로는 지금 위치에서 10초씩 옮긴다', async () => {
    setList(summary());
    vi.mocked(getRecording).mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<RecordingList />);
    await startFirst(user);
    await user.click(screen.getByRole('button', { name: PAUSE }));
    await user.click(screen.getByRole('button', { name: '10초 앞으로' }));
    expect(fake.player.seek).toHaveBeenLastCalledWith(10_000);
    await waitFor(() => expect(slider().value).toBe('10000'));
    await user.click(screen.getByRole('button', { name: '10초 뒤로' }));
    expect(fake.player.seek).toHaveBeenLastCalledWith(0);
  });

  it('쉬는 행에는 끌 막대와 10초 버튼이 없다', async () => {
    setList(summary());
    render(<RecordingList />);
    await screen.findByRole('button', { name: PLAY });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: '10초 앞으로' })).toBeNull();
  });

  it('끝까지 재생하면 막대가 빈 막대로 돌아가고 버튼이 「재생」으로 돌아온다', async () => {
    setList(summary());
    vi.mocked(getRecording).mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<RecordingList />);
    await startFirst(user);
    act(() => {
      fake.state.playing = false;
      fake.emit({ playing: false, reason: 'end' });
    });
    await waitFor(() => expect(screen.queryByRole('slider', { name: '녹음 위치' })).toBeNull());
    expect(screen.getByRole('button', { name: PLAY })).toBeTruthy();
  });
});
