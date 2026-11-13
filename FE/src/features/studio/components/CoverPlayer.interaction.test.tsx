// @vitest-environment happy-dom
// 커버 아래 재생 UI (설계 CHART-003 4-4·6절): 상태별 모양, 10초 이동, is-pinned, 시간 바.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accompanimentBarView, type AccompanimentBarView } from '@/domain/song/freeAccompaniment';
import type { SongSummary } from '@/domain/song/songCatalog';
import type { SongPlayback } from '@/features/studio/domain/songPlayback';
import { CoverPlayer } from './CoverPlayer';

afterEach(cleanup);

const song: SongSummary = {
  id: 7,
  title: '별빛 산책',
  artist: '파란물결',
  source: 'AUDIO',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 204000,
  hasAccompaniment: true,
  accompanimentStatus: 'READY',
  songLevel: null,
  difficulties: [],
  createdAt: '2026-10-29T01:00:00Z',
  coverUrl: null,
  sheetId: null,
};

const NONE = accompanimentBarView({ pick: null, playerState: 'idle', positionMs: 0, durationMs: 0, errorText: null });

function viewOf(state: 'loading' | 'playing' | 'paused' | 'error', songId = 7): AccompanimentBarView {
  return accompanimentBarView({
    pick: { songId, title: '별빛 산책', artist: '파란물결', coverUrl: null },
    playerState: state === 'error' ? 'idle' : state,
    positionMs: 12_000,
    durationMs: 60_000,
    errorText: state === 'error' ? '이 곡은 반주 파일이 없어요' : null,
  });
}

function playback(view: AccompanimentBarView = NONE): SongPlayback {
  return { view, onListen: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onSeek: vi.fn(), onRetry: vi.fn() };
}

const PLAY = '「별빛 산책」 반주 재생';
const PAUSE = '「별빛 산책」 반주 일시정지';
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

describe('CoverPlayer', () => {
  it('쉬는 상태: ▶ 활성(onListen), 10초 버튼은 보이되 비활성, 빈 막대(aria-hidden), is-pinned 없음', () => {
    const p = playback();
    const { container } = render(<CoverPlayer song={song} playback={p} />);
    expect(disabled(PLAY)).toBe(false);
    expect(disabled('10초 뒤로')).toBe(true);
    expect(disabled('10초 앞으로')).toBe(true);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(container.querySelector('.studio-cover-player-track')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.studio-cover-player')?.classList.contains('is-pinned')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: PLAY }));
    expect(p.onListen).toHaveBeenCalledWith(song);
  });

  it('다른 곡이 재생 중이어도 이 곡은 쉬는 상태이고 is-pinned가 아니다', () => {
    const { container } = render(<CoverPlayer song={song} playback={playback(viewOf('playing', 99))} />);
    expect(screen.getByRole('button', { name: PLAY })).toBeTruthy();
    expect(container.querySelector('.is-pinned')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('재생 중: is-pinned, 일시정지 버튼, 시간 글자 없는 시간 바', () => {
    const p = playback(viewOf('playing'));
    const { container } = render(<CoverPlayer song={song} playback={p} />);
    expect(container.querySelector('.studio-cover-player')?.classList.contains('is-pinned')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: PAUSE }));
    expect(p.onPause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('slider', { name: '반주 위치' })).toBeTruthy();
    expect(container.querySelector('.free-seek.is-bare')).toBeTruthy();
    expect(screen.queryByText('0:12')).toBeNull();
  });

  it('일시정지: is-pinned가 남고 ▶는 이어서 재생(onResume)', () => {
    const p = playback(viewOf('paused'));
    const { container } = render(<CoverPlayer song={song} playback={p} />);
    expect(container.querySelector('.is-pinned')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: PLAY }));
    expect(p.onResume).toHaveBeenCalledTimes(1);
    expect(p.onListen).not.toHaveBeenCalled();
  });

  it('10초 뒤로·앞으로는 지금 위치에서 ∓10000ms로 onSeek', () => {
    const p = playback(viewOf('playing'));
    render(<CoverPlayer song={song} playback={p} />);
    fireEvent.click(screen.getByRole('button', { name: '10초 앞으로' }));
    expect(p.onSeek).toHaveBeenLastCalledWith(22_000);
    fireEvent.click(screen.getByRole('button', { name: '10초 뒤로' }));
    expect(p.onSeek).toHaveBeenLastCalledWith(2_000);
  });

  it('시간 바 키보드 이동은 onSeek으로 간다', () => {
    const p = playback(viewOf('playing'));
    render(<CoverPlayer song={song} playback={p} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: '반주 위치' }), { key: 'ArrowRight' });
    expect(p.onSeek).toHaveBeenCalledWith(17_000);
  });

  it('불러오는 중: 세 버튼 비활성, 막대는 is-loading, is-pinned', () => {
    const { container } = render(<CoverPlayer song={song} playback={playback(viewOf('loading'))} />);
    for (const name of ['10초 뒤로', PLAY, '10초 앞으로']) expect(disabled(name)).toBe(true);
    expect(container.querySelector('.studio-cover-player-track.is-loading')).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(container.querySelector('.is-pinned')).toBeTruthy();
  });

  it('오류: 조작 줄 대신 오류 글자(role=alert, title 전문)와 [다시 시도], 시간 바 없음', () => {
    const p = playback(viewOf('error'));
    const { container } = render(<CoverPlayer song={song} playback={p} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('이 곡은 반주 파일이 없어요');
    expect(alert.getAttribute('title')).toBe('이 곡은 반주 파일이 없어요');
    expect(screen.queryByRole('button', { name: PLAY })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(container.querySelector('.studio-cover-player-track')).toBeNull();
    expect(container.querySelector('.is-pinned')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });
});
