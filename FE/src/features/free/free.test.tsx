// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_QUERY } from '@/components/shell/useMediaQuery';
import { SEEK_END_MARGIN_MS, SKIP_MS, seekTarget, type AccompanimentBarView, type AccompanimentPick } from '@/domain/song/freeAccompaniment';
import type { SongSummary } from '@/domain/song/songCatalog';
import { AccompanimentBar } from './AccompanimentBar';
import { AccompanimentPicker } from './AccompanimentPicker';
import { SeekBar } from '@/components/song/SeekBar';
import { DisconnectBand, type BandReconnect } from './DisconnectBand';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noop = () => {};
const idle: BandReconnect = { status: 'idle', attempt: 0, max: 3 };

const pickSong: AccompanimentPick = { songId: 1, title: '곡 제목', artist: '가수', coverUrl: null };
const viewOf = (p: Partial<AccompanimentBarView>): AccompanimentBarView => ({
  phase: 'none', pick: null, positionMs: 0, durationMs: 0, timeText: '0:00 / 0:00', errorText: null, seekable: false, ...p,
});
const NONE = viewOf({});
const PLAYING = viewOf({ phase: 'playing', pick: pickSong, positionMs: 72_000, durationMs: 204_000, timeText: '1:12 / 3:24', seekable: true });

/** ≤640 여부를 가장한다. matchMedia는 useMediaQuery가 읽는다 */
function mockMobile(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === MOBILE_QUERY ? on : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** 제목 칸 100px, 제목 글자 textPx로 측정되게 한다(칸보다 길어야 흐른다) */
function mockTitleWidth(textPx: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('free-accomp-title')) return 100;
    if (this.classList.contains('marquee-item')) return textPx;
    if (this.classList.contains('marquee-group')) return textPx + 32;
    return 0;
  });
}

const css = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

describe('AccompanimentBar', () => {
  it('none: 문구 + [반주 고르기], 「반주」 라벨 없음, 기본 디스크 커버', () => {
    const { container } = render(<AccompanimentBar view={NONE} onPick={noop} />);
    expect(screen.getByText(/반주 없이 연습 중/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '반주 고르기' }) as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector('.free-accomp-label')).toBeNull();
    expect(container.querySelector('.song-cover.default.is-dim')).toBeTruthy();
  });

  it('none: onPick이 없으면 비활성 + builtin 빌드 안내 title', () => {
    render(<AccompanimentBar view={NONE} />);
    const btn = screen.getByRole('button', { name: '반주 고르기' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('이 빌드에서는 반주를 쓸 수 없어요');
  });

  it('playing: 제목·보조 줄·조작부 3개·진행 막대·양끝 시간(경과·남은)·바꾸기·끄기', () => {
    const { container } = render(<AccompanimentBar view={PLAYING} onPick={noop} />);
    expect(screen.getByText('곡 제목')).toBeTruthy();
    expect(screen.getByText('가수 · 드럼 뺀 반주')).toBeTruthy();
    for (const name of ['10초 뒤로', '반주 일시정지', '10초 앞으로', '반주 바꾸기', '반주 끄기']) {
      const b = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(b.title).toBe(name); // 툴팁 = aria-label
    }
    expect((screen.getByLabelText('반주 위치') as HTMLInputElement).getAttribute('aria-valuetext')).toBe('1분 12초 / 3분 24초');
    expect([...container.querySelectorAll('.free-seek-ends > span')].map((e) => e.textContent)).toEqual(['1:12', '-2:12']);
    expect(container.querySelector('.free-seek.is-ends')).toBeTruthy();
    expect(screen.queryByText('1:12 / 3:24')).toBeNull();
    expect(screen.queryByText('반주 없이 연습 중')).toBeNull();
  });

  it('아티스트가 없으면 보조 줄은 「드럼 뺀 반주」만', () => {
    render(<AccompanimentBar view={{ ...PLAYING, pick: { ...pickSong, artist: null } }} />);
    expect(screen.getByText('드럼 뺀 반주')).toBeTruthy();
    expect(screen.queryByText(/ · 드럼 뺀 반주/)).toBeNull();
  });

  it('PlayingEq: playing이면 움직이고 paused·loading·error는 멈춘 점', () => {
    const eq = (v: AccompanimentBarView) => {
      const { container, unmount } = render(<AccompanimentBar view={v} />);
      const cls = container.querySelector('.song-eq')?.className ?? '';
      unmount();
      return cls;
    };
    expect(eq(PLAYING)).toContain('is-playing');
    expect(eq({ ...PLAYING, phase: 'paused' })).toContain('is-paused');
    expect(eq(viewOf({ phase: 'loading', pick: pickSong }))).toContain('is-paused');
    expect(eq(viewOf({ phase: 'error', pick: pickSong, errorText: 'x' }))).toContain('is-paused');
  });

  it('긴 제목은 playing에서만 흐르고 paused·loading·error에서는 말줄임', () => {
    mockTitleWidth(300);
    const long = { ...pickSong, title: '아주 아주 긴 곡 제목입니다 정말로' };
    const flows = (v: AccompanimentBarView) => {
      const { container, unmount } = render(<AccompanimentBar view={v} />);
      const r = Boolean(container.querySelector('.free-accomp-title.marquee'));
      unmount();
      return r;
    };
    expect(flows({ ...PLAYING, pick: long })).toBe(true);
    expect(flows({ ...PLAYING, phase: 'paused', pick: long })).toBe(false);
    expect(flows(viewOf({ phase: 'loading', pick: long }))).toBe(false);
    expect(flows(viewOf({ phase: 'error', pick: long, errorText: 'x' }))).toBe(false);
  });

  it('움직임 줄이기: 흐름·회전·pop·빛 훑기를 CSS가 끈다', () => {
    expect(css('../../components/song/song.css')).toMatch(/prefers-reduced-motion: reduce\)[^@]*\.marquee-track/);
    expect(css('../../components/song/song.css')).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.playback-glyph,[^}]*animation: none/);
    expect(css('./free.css')).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.free-accomp-track::after/);
  });

  it('10초 앞/뒤는 onSeek(위치 ± SKIP_MS), 자르기는 호출자(seekTarget)가 한다', () => {
    const onSeek = vi.fn();
    render(<AccompanimentBar view={PLAYING} onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: '10초 앞으로' }));
    expect(onSeek).toHaveBeenLastCalledWith(72_000 + SKIP_MS);
    fireEvent.click(screen.getByRole('button', { name: '10초 뒤로' }));
    expect(onSeek).toHaveBeenLastCalledWith(72_000 - SKIP_MS);
    // 끝·처음 너머 요청은 훅이 자른다
    const end = 204_000;
    expect(seekTarget(end - 1000 + SKIP_MS, end)).toBe(end - SEEK_END_MARGIN_MS);
    expect(seekTarget(3000 - SKIP_MS, end)).toBe(0);
  });

  it('재생·일시정지 버튼은 상태에 맞는 콜백을 부른다', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { unmount } = render(<AccompanimentBar view={PLAYING} onPause={onPause} onResume={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: '반주 일시정지' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    unmount();
    render(<AccompanimentBar view={{ ...PLAYING, phase: 'paused' }} onPause={onPause} onResume={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: '반주 재생' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('[바꾸기]는 onPick, [끄기]는 onOff', () => {
    const onPick = vi.fn();
    const onOff = vi.fn();
    render(<AccompanimentBar view={PLAYING} onPick={onPick} onOff={onOff} />);
    fireEvent.click(screen.getByRole('button', { name: '반주 바꾸기' }));
    fireEvent.click(screen.getByRole('button', { name: '반주 끄기' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onOff).toHaveBeenCalledTimes(1);
  });

  it('paused: 재생 글리프와 진행 막대', () => {
    render(<AccompanimentBar view={{ ...PLAYING, phase: 'paused' }} />);
    expect(screen.getByRole('button', { name: '반주 재생' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '반주 일시정지' })).toBeNull();
    expect(screen.getByLabelText('반주 위치')).toBeTruthy();
  });

  it('loading: 조작부 비활성·빈 막대·불러오는 중 문구, [바꾸기]도 보인다(D7)', () => {
    const { container } = render(<AccompanimentBar view={viewOf({ phase: 'loading', pick: pickSong })} onPick={noop} />);
    expect(screen.getByText('반주를 불러오는 중…')).toBeTruthy();
    expect(screen.queryByLabelText('반주 위치')).toBeNull();
    for (const name of ['10초 뒤로', '반주 재생', '10초 앞으로']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(container.querySelector('.free-accomp-track-soft')).toBeTruthy();
    expect((screen.getByRole('button', { name: '반주 바꾸기' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: '반주 끄기' })).toBeTruthy();
  });

  it('error: miss 문구(role=alert)와 [다시 시도][다른 곡] + ×, 조작부·막대 없음', () => {
    const onRetry = vi.fn();
    const onPick = vi.fn();
    render(
      <AccompanimentBar
        view={viewOf({ phase: 'error', pick: pickSong, errorText: '이 곡은 반주 파일이 없어요' })}
        onPick={onPick}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('이 곡은 반주 파일이 없어요');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    fireEvent.click(screen.getByRole('button', { name: '다른 곡' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '반주 끄기' })).toBeTruthy();
    expect(screen.queryByLabelText('반주 위치')).toBeNull();
    expect(screen.queryByRole('button', { name: '10초 앞으로' })).toBeNull();
  });

  describe('≤640 미니 바', () => {
    it('커버·제목·「드럼 뺀 반주」·일시정지·10초 앞으로·×만 있고 막대·시간·10초 뒤로는 없다', () => {
      mockMobile(true);
      const { container } = render(<AccompanimentBar view={PLAYING} onPick={noop} />);
      expect(container.querySelector('.free-accomp.is-mini')).toBeTruthy();
      expect(screen.getByText('드럼 뺀 반주')).toBeTruthy();
      expect(screen.queryByText('가수 · 드럼 뺀 반주')).toBeNull();
      expect(screen.getByRole('button', { name: '반주 일시정지' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '10초 앞으로' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '반주 끄기' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '10초 뒤로' })).toBeNull();
      expect(screen.queryByLabelText('반주 위치')).toBeNull();
      expect(container.querySelector('.free-seek')).toBeNull();
      expect(container.querySelector('.free-seek-ends')).toBeNull();
    });

    it('안쪽 아래 2px 진행선은 aria-hidden이고 폭 = 위치/길이', () => {
      mockMobile(true);
      const { container } = render(<AccompanimentBar view={PLAYING} />);
      const line = container.querySelector('.free-accomp-line') as HTMLElement;
      expect(line.getAttribute('aria-hidden')).toBe('true');
      expect((line.querySelector('i') as HTMLElement).style.width).toBe(`${(72_000 / 204_000) * 100}%`);
    });

    it('제목 칸을 누르면 고르기(onPick), 이름은 「반주 바꾸기」', () => {
      mockMobile(true);
      const onPick = vi.fn();
      render(<AccompanimentBar view={PLAYING} onPick={onPick} />);
      fireEvent.click(screen.getByRole('button', { name: '반주 바꾸기' }));
      expect(onPick).toHaveBeenCalledTimes(1);
    });

    it('10초 앞으로는 onSeek(위치 + SKIP_MS)', () => {
      mockMobile(true);
      const onSeek = vi.fn();
      render(<AccompanimentBar view={PLAYING} onSeek={onSeek} />);
      fireEvent.click(screen.getByRole('button', { name: '10초 앞으로' }));
      expect(onSeek).toHaveBeenCalledWith(72_000 + SKIP_MS);
    });

    it('none·loading·error 미니 모양(U1)', () => {
      mockMobile(true);
      const none = render(<AccompanimentBar view={NONE} onPick={noop} />);
      expect(screen.getByText('반주 없이 연습 중')).toBeTruthy();
      expect(screen.getByRole('button', { name: '반주 고르기' })).toBeTruthy();
      none.unmount();
      const loading = render(<AccompanimentBar view={viewOf({ phase: 'loading', pick: pickSong })} />);
      expect(screen.getByText('반주를 불러오는 중…')).toBeTruthy();
      expect((screen.getByRole('button', { name: '반주 재생' }) as HTMLButtonElement).disabled).toBe(true);
      loading.unmount();
      render(<AccompanimentBar view={viewOf({ phase: 'error', pick: pickSong, errorText: '실패했어요' })} />);
      expect(screen.getByRole('alert').textContent).toBe('실패했어요');
      expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
    });
  });
});

describe('AccompanimentPicker', () => {
  const song = (id: number, acc: SongSummary['accompanimentStatus'], over: Partial<SongSummary> = {}): SongSummary => ({
    id, title: `곡${id}`, artist: '가수', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 1000,
    hasAccompaniment: acc === 'READY', accompanimentStatus: acc, songLevel: null, difficulties: [], createdAt: '', coverUrl: null, sheetId: null, ...over,
  });
  const listSongs = async (p: { source: string }) =>
    p.source === 'BUILTIN' ? { items: [song(1, 'READY'), song(2, 'GENERATING'), song(3, 'NONE')], hasNext: true } : { items: [], hasNext: false };
  const renderPicker = (props: Partial<React.ComponentProps<typeof AccompanimentPicker>> = {}) =>
    render(
      <MemoryRouter>
        <AccompanimentPicker currentSongId={null} onPick={noop} onClose={noop} songsDeps={{ listSongs }} {...props} />
      </MemoryRouter>,
    );

  it('공용 곡·내 곡 섹션, 생성 중은 비활성, 반주 없는 곡은 숨김, 더 보기·빈 문구', async () => {
    renderPicker();
    await screen.findByText('곡1');
    expect(screen.getByRole('region', { name: '공용 곡' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '내 곡' })).toBeTruthy();
    expect(screen.queryByText('곡3')).toBeNull();
    expect(screen.getByText('곡2').closest('button')?.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('더 보기')).toBeTruthy();
    expect(await screen.findByText(/반주가 있는 내 곡이 없어요/)).toBeTruthy();
  });

  it('반주 만드는 중 곡은 「반주 만드는 중」 배지(active 색)를 낸다. 「채보 생성 중」이 아니다', async () => {
    const { container } = renderPicker();
    await screen.findByText('곡1');
    const badge = screen.getByText('반주 만드는 중');
    expect(badge.className).toContain('studio-badge-active');
    expect(container.querySelector('.studio-badge-dot')).toBeTruthy();
    expect(screen.queryByText('채보 생성 중')).toBeNull();
  });

  it('커버가 없는 곡은 기본 디스크 커버', async () => {
    const { container } = renderPicker();
    await screen.findByText('곡1');
    expect(container.querySelectorAll('.free-picker-row .song-cover.default').length).toBeGreaterThan(0);
  });

  it('곡을 누르면 고른 곡 정보로 onPick', async () => {
    const onPick = vi.fn();
    renderPicker({ onPick });
    fireEvent.click((await screen.findByText('곡1')).closest('button')!);
    expect(onPick).toHaveBeenCalledWith({ songId: 1, title: '곡1', artist: '가수', coverUrl: null });
  });

  it('지금 곡: 강조 + 「재생 중」 글자 + PlayingEq(재생 중이면 움직임, 아니면 멈춘 점), 다시 누르면 onPick 없이 닫기만', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const { container, unmount } = renderPicker({ currentSongId: 1, currentPlaying: true, onPick, onClose });
    expect(await screen.findByText('재생 중')).toBeTruthy();
    expect(container.querySelector('.free-picker-row.is-current')).toBeTruthy();
    expect(container.querySelector('.free-picker-row.is-current .song-eq.is-playing')).toBeTruthy();
    fireEvent.click(screen.getByText('곡1').closest('button')!);
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    unmount();
    const paused = renderPicker({ currentSongId: 1, currentPlaying: false });
    await screen.findByText('재생 중');
    expect(paused.container.querySelector('.free-picker-row.is-current .song-eq.is-paused')).toBeTruthy();
    expect(screen.getByRole('img', { name: '일시정지' })).toBeTruthy();
  });

  it('× 닫기(「닫기」)와 검색어 지우기 ×(「검색어 지우기」, 검색어가 있을 때만)', async () => {
    const onClose = vi.fn();
    renderPicker({ onClose });
    await screen.findByText('곡1');
    expect(screen.queryByRole('button', { name: '검색어 지우기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const input = screen.getByLabelText('반주 검색') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '별' } });
    fireEvent.click(screen.getByRole('button', { name: '검색어 지우기' }));
    expect(input.value).toBe('');
    expect(screen.queryByRole('button', { name: '검색어 지우기' })).toBeNull();
  });

  it('처음 포커스는 검색창, Esc로 닫는다', async () => {
    const onClose = vi.fn();
    renderPicker({ onClose });
    await screen.findByText('곡1');
    expect(document.activeElement).toBe(screen.getByLabelText('반주 검색'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('데스크톱은 is-sheet 없음, ≤640은 is-sheet + 손잡이 막대(aria-hidden), 「재생 중」 글자 없이 이퀄라이저만', async () => {
    const desktop = renderPicker({ currentSongId: 1 });
    await screen.findByText('곡1');
    expect(document.querySelector('.dialog.free-picker')).toBeTruthy();
    expect(document.querySelector('.free-picker.is-sheet')).toBeNull();
    expect(document.querySelector('.free-picker-grab')).toBeNull();
    desktop.unmount();
    mockMobile(true);
    renderPicker({ currentSongId: 1, currentPlaying: true });
    await screen.findByText('곡1');
    expect(document.querySelector('.dialog.free-picker.is-sheet')).toBeTruthy();
    expect(document.querySelector('.free-picker-grab')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText('재생 중')).toBeNull();
    expect(screen.getByRole('img', { name: '재생 중' })).toBeTruthy();
  });

  it('목록 실패는 섹션별 문구와 다시 시도, 다른 섹션은 그대로', async () => {
    renderPicker({
      songsDeps: {
        listSongs: async (p: { source: string }) => {
          if (p.source === 'MINE') throw new Error('x');
          return { items: [song(1, 'READY')], hasNext: false };
        },
      },
    });
    expect(await screen.findByText(/목록을 불러오지 못했어요/)).toBeTruthy();
    expect(screen.getByText('곡1')).toBeTruthy();
  });
});

describe('SeekBar layout="ends"', () => {
  it('시간을 막대 아래 양끝에 경과 · 남은 시간으로 둔다', () => {
    const { container } = render(<SeekBar layout="ends" positionMs={72_000} durationMs={204_000} onSeek={noop} />);
    expect(container.querySelector('.free-seek.is-ends')).toBeTruthy();
    expect(container.querySelector('.free-seek-time')).toBeNull();
    const ends = container.querySelectorAll('.free-seek-ends > span');
    expect([...ends].map((e) => e.textContent)).toEqual(['1:12', '-2:12']);
  });

  it('기본 배치는 그대로 「경과 / 전체」', () => {
    const { container } = render(<SeekBar positionMs={72_000} durationMs={204_000} onSeek={noop} />);
    expect(container.querySelector('.free-seek.is-ends')).toBeNull();
    expect(container.querySelector('.free-seek-time')?.textContent).toBe('1:12 / 3:24');
  });
});

describe('SeekBar', () => {
  const setup = (onSeek = vi.fn(), positionMs = 72_000) => {
    render(<SeekBar positionMs={positionMs} durationMs={204_000} onSeek={onSeek} />);
    return { onSeek, range: screen.getByLabelText('반주 위치') as HTMLInputElement };
  };

  it('aria-valuetext와 시간 글자', () => {
    const { range } = setup();
    expect(range.getAttribute('aria-valuetext')).toBe('1분 12초 / 3분 24초');
    expect(screen.getByText('1:12 / 3:24')).toBeTruthy();
  });

  it('←/→는 5초, Home은 처음, End는 끝(자르기는 호출자)', () => {
    const { onSeek, range } = setup();
    fireEvent.keyDown(range, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(77_000);
    fireEvent.keyDown(range, { key: 'ArrowLeft' });
    expect(onSeek).toHaveBeenLastCalledWith(67_000);
    fireEvent.keyDown(range, { key: 'Home' });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(range, { key: 'End' });
    expect(onSeek).toHaveBeenLastCalledWith(204_000);
  });

  it('문자·숫자 키(드럼 연주 키)는 막대가 쓰지 않는다', () => {
    const { onSeek, range } = setup();
    for (const key of ['f', 'j', ' ', '1']) fireEvent.keyDown(range, { key });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('끄는 동안은 시간 글자만 따라가고 손을 떼면 onSeek 한 번', () => {
    const { onSeek, range } = setup();
    fireEvent.pointerDown(range);
    fireEvent.change(range, { target: { value: '100000' } });
    fireEvent.change(range, { target: { value: '120000' } });
    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.getByText('2:00 / 3:24')).toBeTruthy();
    fireEvent.pointerUp(range);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(120_000);
  });
});

describe('DisconnectBand', () => {
  it('끊긴 손을 제목에 쓴다', () => {
    expect(renderToStaticMarkup(<DisconnectBand left={true} right={false} reconnect={idle} />)).toContain('오른손 스틱 연결이 끊겼어요');
    expect(renderToStaticMarkup(<DisconnectBand left={false} right={true} reconnect={idle} />)).toContain('왼손 스틱 연결이 끊겼어요');
  });

  it('role=status', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).toContain('role="status"');
  });

  it('idle: 살아있는 손은 계속 칠 수 있다는 문구', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).toContain('왼손은 계속 칠 수 있어요');
    expect(renderToStaticMarkup(<DisconnectBand left={false} right reconnect={idle} />)).toContain('오른손은 계속 칠 수 있어요');
  });

  it('trying: 시도 횟수 표시', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'trying', attempt: 2, max: 3 }} onReconnect={noop} />,
    );
    expect(html).toContain('다시 연결하는 중');
    expect(html).toContain('(2/3)');
    expect(html).not.toContain('aria-disabled');
    expect(html).toContain('stick-spinner');
    expect(html).toContain('free-band-dot off pulse');
  });

  it('failed: hint를 문구 뒤에 보인다', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'failed', attempt: 3, max: 3, hint: '동글을 뺐다 다시 꽂아 주세요' }} />,
    );
    expect(html).toContain('연결하지 못했어요. 동글을 뺐다 다시 꽂아 주세요');
  });

  it('reconnected: 「재연결 성공!」만, 버튼 없음', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'reconnected', attempt: 0, max: 3 }} onReconnect={noop} />,
    );
    expect(html).toContain('재연결 성공!');
    expect(html).not.toContain('다시 연결');
    expect(html).not.toContain('free-band-dot off');
  });

  it('failed: 드럼 세팅 안내', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'failed', attempt: 3, max: 3 }} />,
    );
    expect(html).toContain('연결하지 못했어요');
    expect(html).toContain('드럼 세팅');
  });

  it('onReconnect가 없으면 다시 연결 버튼이 없다', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).not.toContain('다시 연결');
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} onReconnect={noop} />)).toContain('다시 연결');
  });
});

describe('DisconnectBand 페달', () => {
  const band = (p: { left: boolean; right: boolean; pedal?: boolean; reconnect?: BandReconnect }) =>
    renderToStaticMarkup(<DisconnectBand left={p.left} right={p.right} pedal={p.pedal} reconnect={p.reconnect ?? idle} />);

  // 인수 조건: pedal이 undefined면 P 점·"페달" 문구가 없다
  it('pedal이 없으면 P 점과 페달 문구가 없다', () => {
    const html = band({ left: true, right: false });
    expect(html).not.toContain('>P<');
    expect(html).not.toContain('페달');
  });

  // 인수 조건: 페달만 끊기면 "페달 연결이 끊겼어요", 부제는 "스틱은 계속 칠 수 있어요"
  it('손이 모두 연결이고 페달만 끊기면 페달 제목과 스틱 부제', () => {
    const html = band({ left: true, right: true, pedal: false });
    expect(html).toContain('페달 연결이 끊겼어요');
    expect(html).not.toContain('스틱·페달');
    expect(html).toContain('스틱은 계속 칠 수 있어요');
    expect(html).toContain('>P<');
    expect(html).toContain('free-band-dot off');
  });

  // 인수 조건: 손이 하나라도 끊기면 "스틱·페달 연결이 끊겼어요"
  it('손도 끊겼으면 스틱·페달 제목', () => {
    expect(band({ left: true, right: false, pedal: false })).toContain('스틱·페달 연결이 끊겼어요');
  });

  // 인수 조건: reconnected면 P 점 on, off 없음
  it('reconnected면 P 점도 on', () => {
    const html = band({ left: true, right: true, pedal: false, reconnect: { status: 'reconnected', attempt: 0, max: 3 } });
    expect(html.match(/free-band-dot on/g)).toHaveLength(3);
    expect(html).not.toContain('free-band-dot off');
  });
});
