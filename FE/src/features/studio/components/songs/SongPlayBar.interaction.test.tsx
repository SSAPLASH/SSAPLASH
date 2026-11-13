// @vitest-environment happy-dom
// 라이브러리 곡 재생바와 카드·목록 줄 연결 (설계 CHART-003 라이브러리 재생바 A1·A2·A4·A6).
// 재생바는 반주가 준비된 완료 곡에 항상 보인다(쉬는 상태: ▶ + 빈 막대 + 곡 길이). ▶를 누르면 그 곡이 재생 대상이 된다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accompanimentBarView, type AccompanimentBarView } from '@/domain/song/freeAccompaniment';
import type { SongSummary } from '@/domain/song/songCatalog';
import type { SongPlayback } from '@/features/studio/domain/songPlayback';
import { MySongCard } from './MySongCard';
import { MySongList } from './MySongList';
import { MySongRow } from './MySongRow';
import { SongPlayBar } from './SongPlayBar';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 제목 칸 200px, 제목 글자 textPx로 측정되게 한다(칸보다 길어야 흐른다) */
function mockTitleWidth(textPx: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('studio-card-title') || this.classList.contains('studio-row-title')) return 200;
    if (this.classList.contains('marquee-item')) return textPx;
    if (this.classList.contains('marquee-group')) return textPx + 32;
    return 0;
  });
}

const song = (over: Partial<SongSummary> = {}): SongSummary => ({
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
  ...over,
});

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

describe('SongPlayBar', () => {
  it('쉬는 상태: ▶와 빈 막대, 곡 길이. ▶를 누르면 그 곡으로 onListen', () => {
    const p = playback();
    const s = song();
    render(<SongPlayBar song={s} playback={p} />);
    // 막대 아래 양끝: 경과 · 남은 시간
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByText('-3:24')).toBeTruthy();
    // 10초 버튼은 쉬는 상태에 없다(자리만 비운다)
    expect(screen.queryByRole('button', { name: '10초 뒤로' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: PLAY }));
    expect(p.onListen).toHaveBeenCalledWith(s);
    expect(p.onResume).not.toHaveBeenCalled();
  });

  it('쉬는 상태: 곡 길이를 모르면 시간 글자를 두지 않는다', () => {
    const { container } = render(<SongPlayBar song={song({ durationMs: null })} playback={playback()} />);
    expect(container.querySelector('.free-seek-ends')?.textContent).toBe('');
  });

  it('다른 곡이 재생 중이어도 이 곡은 쉬는 상태다', () => {
    const p = playback(viewOf('playing', 99));
    render(<SongPlayBar song={song()} playback={p} />);
    expect(screen.getByRole('button', { name: PLAY })).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('재생 중: 일시정지 버튼과 진행 막대', () => {
    const p = playback(viewOf('playing'));
    render(<SongPlayBar song={song()} playback={p} />);
    fireEvent.click(screen.getByRole('button', { name: PAUSE }));
    expect(p.onPause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('slider', { name: '반주 위치' })).toBeTruthy();
    expect(screen.getByText('0:12')).toBeTruthy();
    expect(screen.getByText('-0:48')).toBeTruthy();
  });

  it('일시정지: ▶는 처음부터가 아니라 이어서 재생(onResume)', () => {
    const p = playback(viewOf('paused'));
    render(<SongPlayBar song={song()} playback={p} />);
    fireEvent.click(screen.getByRole('button', { name: PLAY }));
    expect(p.onResume).toHaveBeenCalledTimes(1);
    expect(p.onListen).not.toHaveBeenCalled();
  });

  it('진행 막대 키보드 이동은 onSeek으로 간다', () => {
    const p = playback(viewOf('playing'));
    render(<SongPlayBar song={song()} playback={p} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: '반주 위치' }), { key: 'ArrowRight' });
    expect(p.onSeek).toHaveBeenCalledWith(17_000);
  });

  it('10초 뒤로·앞으로는 지금 위치에서 10초씩 옮긴다', () => {
    const p = playback(viewOf('playing'));
    render(<SongPlayBar song={song()} playback={p} />);
    fireEvent.click(screen.getByRole('button', { name: '10초 앞으로' }));
    expect(p.onSeek).toHaveBeenLastCalledWith(22_000);
    fireEvent.click(screen.getByRole('button', { name: '10초 뒤로' }));
    expect(p.onSeek).toHaveBeenLastCalledWith(2_000);
  });

  it('불러오는 중: 안내 글자, 버튼은 눌리지 않는다', () => {
    render(<SongPlayBar song={song()} playback={playback(viewOf('loading'))} />);
    expect(screen.getByText('반주를 불러오는 중…')).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
    for (const name of ['10초 뒤로', PLAY, '10초 앞으로']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('오류: 문구와 [다시 시도]', () => {
    const p = playback(viewOf('error'));
    render(<SongPlayBar song={song()} playback={p} />);
    expect(screen.getByRole('alert').textContent).toContain('이 곡은 반주 파일이 없어요');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });
});

const renderCard = (s: SongSummary, p?: SongPlayback) =>
  render(
    <MemoryRouter>
      <ul>
        <MySongCard song={s} justDone={false} onReupload={() => {}} playback={p} />
      </ul>
    </MemoryRouter>,
  );
const renderRow = (s: SongSummary, p?: SongPlayback) =>
  render(
    <MemoryRouter>
      <ul>
        <MySongRow song={s} justDone={false} onReupload={() => {}} playback={p} />
      </ul>
    </MemoryRouter>,
  );

describe.each([
  // 카드 보기는 커버 아래 재생 UI(.studio-cover-player), 목록 줄은 재생바(.song-playbar)를 쓴다
  ['MySongCard', renderCard, 'studio-card-title', '.studio-cover-player'],
  ['MySongRow', renderRow, 'studio-row-title', '.song-playbar'],
] as const)('%s 재생바', (_name, renderItem, titleClass, barSelector) => {
  it('반주가 준비된 완료 곡에만 재생바가 기본으로 보인다(A1)', () => {
    const { container } = renderItem(song(), playback());
    expect(container.querySelector(barSelector)).toBeTruthy();
    expect(screen.getByRole('button', { name: PLAY })).toBeTruthy();
    cleanup();
    for (const s of [
      song({ accompanimentStatus: 'NONE', hasAccompaniment: false, source: 'MIDI' }),
      song({ accompanimentStatus: 'GENERATING' }),
      song({ status: 'PROCESSING' }),
      song({ status: 'FAILED' }),
    ]) {
      const r = renderItem(s, playback());
      expect(r.container.querySelector(barSelector)).toBeNull();
      cleanup();
    }
  });

  it('듣기(헤드폰) 버튼은 없다', () => {
    const { container } = renderItem(song(), playback());
    expect(container.querySelector('.song-listen-btn')).toBeNull();
    expect(screen.queryByRole('button', { name: /반주 듣기/ })).toBeNull();
  });

  it('playback이 없으면 재생바를 그리지 않는다', () => {
    const { container } = renderItem(song());
    expect(container.querySelector(barSelector)).toBeNull();
  });

  it('제목 옆 이퀄라이저: 재생 대상 곡에만 있고, 재생 중이면 움직이고 일시정지면 납작하다', () => {
    const idle = renderItem(song(), playback());
    expect(idle.container.querySelector('.song-eq')).toBeNull();
    cleanup();
    const other = renderItem(song(), playback(viewOf('playing', 99)));
    expect(other.container.querySelector('.song-eq')).toBeNull();
    cleanup();
    const playing = renderItem(song(), playback(viewOf('playing')));
    expect(playing.container.querySelector('.song-title-line .song-eq')?.classList.contains('is-playing')).toBe(true);
    expect(screen.getByRole('img', { name: '재생 중' })).toBeTruthy();
    cleanup();
    const paused = renderItem(song(), playback(viewOf('paused')));
    expect(paused.container.querySelector('.song-eq')?.classList.contains('is-paused')).toBe(true);
  });

  it('보조 줄(아티스트)은 재생 중에도 그대로 보인다', () => {
    renderItem(song(), playback(viewOf('playing')));
    expect(screen.getByText('파란물결')).toBeTruthy();
  });

  it('재생 중인 곡: 진행 막대가 움직이고 칸보다 긴 제목이 흐른다(A2·A4)', () => {
    mockTitleWidth(400);
    const { container } = renderItem(song(), playback(viewOf('playing')));
    expect(screen.getByRole('slider', { name: '반주 위치' })).toBeTruthy();
    expect(container.querySelector(`.${titleClass}`)?.classList.contains('marquee')).toBe(true);
  });

  it('재생 중이어도 칸에 들어가는 짧은 제목은 흐르지 않는다(A4)', () => {
    mockTitleWidth(40);
    const { container } = renderItem(song(), playback(viewOf('playing')));
    expect(container.querySelector('.marquee')).toBeNull();
    expect(container.querySelector(`.${titleClass}`)?.textContent).toBe('별빛 산책');
  });

  it('일시정지: 제목은 말줄임으로 돌아온다(A4)', () => {
    mockTitleWidth(400);
    const { container } = renderItem(song(), playback(viewOf('paused')));
    expect(screen.getByRole('button', { name: PLAY })).toBeTruthy();
    expect(container.querySelector(`.${titleClass}`)?.classList.contains('marquee')).toBe(false);
  });

  it('다른 곡이 재생 중이면 이 곡은 쉬는 재생바이고 제목은 흐르지 않는다', () => {
    mockTitleWidth(400);
    const { container } = renderItem(song(), playback(viewOf('playing', 99)));
    expect(screen.getByRole('button', { name: PLAY })).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(container.querySelector('.marquee')).toBeNull();
  });
});

describe('MySongList 재생바 전달', () => {
  const list = (view: 'card' | 'list', p: SongPlayback) =>
    render(
      <MemoryRouter>
        <MySongList
          status="ready"
          items={[song(), song({ id: 8, title: '둘째 곡' })]}
          error={null}
          onRetry={() => {}}
          active={null}
          progress={null}
          justDoneId={null}
          onReupload={() => {}}
          view={view}
          playback={p}
        />
      </MemoryRouter>,
    );

  it.each(['card', 'list'] as const)('%s 보기: 곡마다 재생바, 재생 중인 곡에만 움직이는 진행 막대', (view) => {
    const p = playback(viewOf('playing', 8));
    const { container } = list(view, p);
    // 카드 보기는 `.studio-cover-player`, 목록 보기는 `.song-playbar`
    expect(container.querySelectorAll(view === 'card' ? '.studio-cover-player' : '.song-playbar')).toHaveLength(2);
    expect(container.querySelectorAll(view === 'card' ? '.song-playbar' : '.studio-cover-player')).toHaveLength(0);
    expect(screen.getByRole('button', { name: PLAY })).toBeTruthy();
    expect(screen.getByRole('button', { name: '「둘째 곡」 반주 일시정지' })).toBeTruthy();
    expect(screen.getAllByRole('slider', { name: '반주 위치' })).toHaveLength(1);
  });
});
