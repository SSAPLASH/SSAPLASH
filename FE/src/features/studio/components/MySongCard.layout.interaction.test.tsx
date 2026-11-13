// @vitest-environment happy-dom
// 라이브러리 카드 개편 (설계 CHART-003 6절): 카드 배치·[플레이]·맨 아래 버튼·커버 재생 UI·강조 클래스·긴 제목.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accompanimentBarView, type AccompanimentBarView } from '@/domain/song/freeAccompaniment';
import type { SongSummary } from '@/domain/song/songCatalog';
import type { SongPlayback } from '@/features/studio/domain/songPlayback';
import { MySongCard } from './MySongCard';
import { MySongRow } from './MySongRow';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
function viewOf(state: 'playing' | 'paused', songId = 7): AccompanimentBarView {
  return accompanimentBarView({
    pick: { songId, title: '별빛 산책', artist: '파란물결', coverUrl: null },
    playerState: state,
    positionMs: 12_000,
    durationMs: 60_000,
    errorText: null,
  });
}
function playback(view: AccompanimentBarView = NONE): SongPlayback {
  return { view, onListen: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onSeek: vi.fn(), onRetry: vi.fn() };
}

interface CardOpts {
  playback?: SongPlayback;
  onSheet?: () => void;
  onReupload?: () => void;
}
function renderCard(s: SongSummary, { playback: p, onSheet, onReupload }: CardOpts = {}) {
  return render(
    <MemoryRouter>
      <ul>
        <MySongCard song={s} justDone={false} onReupload={onReupload ?? (() => {})} onEdit={() => {}} onSheet={onSheet} playback={p} />
      </ul>
    </MemoryRouter>,
  );
}

/** 제목 칸 200px, 제목 글자 400px로 측정되게 한다(칸보다 길어야 흐른다) */
function mockLongTitle() {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('studio-card-title')) return 200;
    if (this.classList.contains('marquee-item')) return 400;
    if (this.classList.contains('marquee-group')) return 432;
    return 0;
  });
}

describe('MySongCard [플레이]', () => {
  it('완료 곡에만 [플레이]가 있다. 생성 실패·처리 중 곡에는 없다', () => {
    renderCard(song());
    expect(screen.getByRole('button', { name: '「별빛 산책」 플레이' })).toBeTruthy();
    cleanup();
    for (const status of ['FAILED', 'PROCESSING']) {
      renderCard(song({ status }));
      expect(screen.queryByRole('button', { name: /플레이/ })).toBeNull();
      cleanup();
    }
  });

  it('커버 위 원형 ▶ 링크와 [악보 연습] 링크가 없다', () => {
    const { container } = renderCard(song(), { onSheet: () => {} });
    expect(container.querySelector('.song-card-play')).toBeNull();
    expect(screen.queryByRole('link', { name: /리듬 게임/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /악보 연습/ })).toBeNull();
  });

  it('[플레이]를 열면 메뉴가 카드 밖(body)에 뜨고 카드에 is-menu-open이 붙었다가 닫으면 빠진다', async () => {
    const user = userEvent.setup();
    const { container } = renderCard(song());
    const li = container.querySelector('li.studio-card') as HTMLElement;
    expect(li.classList.contains('is-menu-open')).toBe(false);
    await user.click(screen.getByRole('button', { name: '「별빛 산책」 플레이' }));
    expect(li.classList.contains('is-menu-open')).toBe(true);
    expect(within(li).queryByRole('menu')).toBeNull();
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(li.classList.contains('is-menu-open')).toBe(false);
  });
});

describe('MySongCard 재생바 없음·커버 재생 UI', () => {
  it('카드에는 song-playbar가 없고 커버에 재생 UI가 있다. 목록 줄(MySongRow)은 재생바를 그대로 쓴다', () => {
    const p = playback();
    const card = renderCard(song(), { playback: p });
    expect(card.container.querySelector('.song-playbar')).toBeNull();
    expect(card.container.querySelector('.studio-card-cover .studio-cover-player')).toBeTruthy();
    cleanup();
    const row = render(
      <MemoryRouter>
        <ul>
          <MySongRow song={song()} justDone={false} onReupload={() => {}} playback={p} />
        </ul>
      </MemoryRouter>,
    );
    expect(row.container.querySelector('.song-playbar')).toBeTruthy();
    expect(row.container.querySelector('.studio-cover-player')).toBeNull();
  });

  it('MIDI·반주 없는 곡·playback 없음·실패·처리 중 곡에는 재생 UI가 없다', () => {
    for (const [s, p] of [
      [song({ source: 'MIDI', hasAccompaniment: false, accompanimentStatus: 'NONE' }), playback()],
      [song({ accompanimentStatus: 'GENERATING' }), playback()],
      [song({ status: 'FAILED' }), playback()],
      [song({ status: 'PROCESSING' }), playback()],
      [song(), undefined],
    ] as const) {
      const { container } = renderCard(s, { playback: p });
      expect(container.querySelector('.studio-cover-player')).toBeNull();
      cleanup();
    }
  });

  it('재생 중·일시정지면 재생 UI가 is-pinned, 쉬는 상태면 아니다', () => {
    for (const [view, pinned] of [
      [NONE, false],
      [viewOf('playing', 99), false],
      [viewOf('playing'), true],
      [viewOf('paused'), true],
    ] as const) {
      const { container } = renderCard(song(), { playback: playback(view) });
      expect(container.querySelector('.studio-cover-player')?.classList.contains('is-pinned')).toBe(pinned);
      cleanup();
    }
  });
});

describe('MySongCard 제목 줄', () => {
  it('긴 제목은 재생 중에만 흐르고 이퀄라이저는 재생 대상에만 붙는다', () => {
    mockLongTitle();
    const idle = renderCard(song(), { playback: playback() });
    expect(idle.container.querySelector('.marquee')).toBeNull();
    expect(idle.container.querySelector('.song-eq')).toBeNull();
    cleanup();
    const other = renderCard(song(), { playback: playback(viewOf('playing', 99)) });
    expect(other.container.querySelector('.marquee')).toBeNull();
    expect(other.container.querySelector('.song-eq')).toBeNull();
    cleanup();
    const playing = renderCard(song(), { playback: playback(viewOf('playing')) });
    expect(playing.container.querySelector('.studio-card-title')?.classList.contains('marquee')).toBe(true);
    expect(playing.container.querySelector('.song-title-line .song-eq')?.classList.contains('is-playing')).toBe(true);
    cleanup();
    const paused = renderCard(song(), { playback: playback(viewOf('paused')) });
    expect(paused.container.querySelector('.marquee')).toBeNull();
    expect(paused.container.querySelector('.song-eq')?.classList.contains('is-paused')).toBe(true);
  });
});

describe('MySongCard 맨 아래 버튼', () => {
  it('악보가 있으면 /studio/sheets/{id} 링크 [악보 보기]', () => {
    renderCard(song({ sheetId: 4 }), { onSheet: () => {} });
    const link = screen.getByRole('link', { name: '악보 보기' });
    expect(link.getAttribute('href')).toBe('/studio/sheets/4');
    expect(link.className).toContain('ui-btn-secondary');
    expect(link.className).toContain('ui-btn-full');
  });

  it('악보가 없으면 [악보 올리기](text)가 onSheet(sheetUpload, 곡)을 부른다', async () => {
    const onSheet = vi.fn();
    const s = song();
    renderCard(s, { onSheet });
    const btn = screen.getByRole('button', { name: '악보 올리기' });
    expect(btn.className).toContain('ui-btn-text');
    await userEvent.setup().click(btn);
    expect(onSheet).toHaveBeenCalledWith('sheetUpload', s);
  });

  it('악보 연결이 꺼져 있으면(onSheet 없음) 비활성 [악보 보기]와 title 툴팁, 링크는 없다', () => {
    renderCard(song({ sheetId: 4 }));
    const btn = screen.getByRole('button', { name: '악보 보기' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('악보 연결이 꺼져 있어요');
    expect(screen.queryByRole('link', { name: '악보 보기' })).toBeNull();
    expect(screen.queryByText('악보 연결이 꺼져 있어요')).toBeNull();
  });

  it('생성 실패 곡은 [다시 올리기]만 있다. 처리 중 곡은 맨 아래 버튼이 없다', async () => {
    const onReupload = vi.fn();
    const failed = song({ status: 'FAILED' });
    renderCard(failed, { onReupload, onSheet: () => {} });
    await userEvent.setup().click(screen.getByRole('button', { name: '다시 올리기' }));
    expect(onReupload).toHaveBeenCalledWith(failed);
    expect(screen.queryByRole('button', { name: /악보/ })).toBeNull();
    cleanup();
    const { container } = renderCard(song({ status: 'PROCESSING' }), { onSheet: () => {} });
    expect(container.querySelector('.studio-card-actions')).toBeNull();
  });

  it('실패 사유는 배지 줄 안에 있다', () => {
    const { container } = renderCard(song({ status: 'FAILED' }));
    expect(container.querySelector('.studio-card-badges .studio-card-reason')?.textContent).toBe('채보를 만들지 못했어요');
  });
});
