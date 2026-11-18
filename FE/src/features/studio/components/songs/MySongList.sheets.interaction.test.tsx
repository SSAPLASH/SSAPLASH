// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SheetSummary } from '@/features/studio/domain/sheetMusic';
import type { SongSummary } from '@/domain/song/songCatalog';
import { MySongList, type StudioView } from './MySongList';

afterEach(cleanup);

const song = (over: Partial<SongSummary> = {}): SongSummary => ({
  id: 1,
  title: '별빛 산책',
  artist: '파란물결',
  source: 'MIDI',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 60000,
  hasAccompaniment: false,
  accompanimentStatus: 'NONE',
  songLevel: null,
  difficulties: [],
  createdAt: '2026-10-29T01:00:00Z',
  coverUrl: null,
  sheetId: null,
  ...over,
});
const sheet = (over: Partial<SheetSummary> = {}): SheetSummary => ({
  id: 10,
  title: '합주 악보',
  kind: 'IMAGE',
  pageCount: 3,
  thumbnailUrl: 'https://x/t.png',
  createdAt: '2026-11-01T01:00:00Z',
  songId: null,
  ...over,
});

function renderList(view: StudioView, extra: Partial<Parameters<typeof MySongList>[0]> = {}) {
  return render(
    <MemoryRouter>
      <MySongList
        status="ready"
        items={[song()]}
        error={null}
        onRetry={() => {}}
        active={null}
        progress={null}
        justDoneId={null}
        onReupload={() => {}}
        view={view}
        onEdit={() => {}}
        sheets={[sheet(), sheet({ id: 11, title: 'PDF 악보', kind: 'PDF', pageCount: 5, thumbnailUrl: null })]}
        {...extra}
      />
    </MemoryRouter>,
  );
}

describe.each<StudioView>(['card', 'list'])('악보 항목 (%s 보기)', (view) => {
  it('곡과 한 목록에 섞여 보이고 부제·칩·[악보 보기] 링크가 있다', () => {
    renderList(view);
    expect(screen.getByText('별빛 산책')).toBeTruthy();
    expect(screen.getByText('악보 · 이미지 3쪽')).toBeTruthy();
    expect(screen.getByText('악보 · PDF')).toBeTruthy();
    expect(screen.getAllByText('악보만')).toHaveLength(2);
    const links = screen.getAllByRole('link', { name: '악보 보기' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/studio/sheets/10', '/studio/sheets/11']);
  });

  it('비활성 [악보 연습]·설명 문구가 없고, 스위치 꺼짐(onUploadSong 없음)이면 곡 올리기 버튼도 없다', () => {
    renderList(view);
    // 곡의 [악보 연습]은 링크라 버튼 역할로는 하나도 없다
    expect(screen.queryAllByRole('button', { name: '악보 연습' })).toHaveLength(0);
    expect(screen.queryByText('음원이 있어야 할 수 있어요')).toBeNull();
    expect(screen.queryByRole('button', { name: /곡 올리기/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /리듬 게임/ })).toBeNull();
  });

  it('onUploadSong이 있으면 악보마다 [곡 올리기] 버튼이 있고 누르면 그 악보를 넘긴다', async () => {
    const onUploadSong = vi.fn();
    const user = userEvent.setup();
    renderList(view, { onUploadSong });
    const btns = screen.getAllByRole('button', { name: /곡 올리기$/ });
    expect(btns.map((b) => b.getAttribute('aria-label'))).toEqual(['「합주 악보」 곡 올리기', '「PDF 악보」 곡 올리기']);
    await user.click(btns[1]);
    expect(onUploadSong).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
  });

  it('썸네일이 있으면 이미지, PDF는 자리표시', () => {
    const { container } = renderList(view);
    expect(container.querySelectorAll('img[src="https://x/t.png"]')).toHaveLength(1);
    expect(container.querySelectorAll('.studio-sheet-placeholder')).toHaveLength(1);
  });

  it('⋯ 메뉴에서 악보 삭제를 고르면 onSheetMenu로 알린다', async () => {
    const onSheetMenu = vi.fn();
    const user = userEvent.setup();
    renderList(view, { onSheetMenu });
    await user.click(screen.getByRole('button', { name: '합주 악보 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '악보 삭제' }));
    expect(onSheetMenu).toHaveBeenCalledWith('delete', expect.objectContaining({ id: 10 }));
  });
});

describe('카드 보기의 곡 올리기 버튼', () => {
  it('▶ 자리(song-card-play)에 같은 크기의 업로드 버튼을 두고 title이 「곡 올리기」다', () => {
    renderList('card', { onUploadSong: () => {} });
    const btn = screen.getByRole('button', { name: '「합주 악보」 곡 올리기' });
    expect(btn.className).toContain('song-card-play');
    expect(btn.className).toContain('song-card-upload');
    expect(btn.getAttribute('title')).toBe('곡 올리기');
  });

  it('목록 보기는 [악보 보기] 다음에 [곡 올리기]가 온다', () => {
    const { container } = renderList('list', { onUploadSong: () => {} });
    const actions = container.querySelector('.studio-row.sheet .studio-row-actions') as HTMLElement;
    expect(Array.from(actions.children).map((c) => c.textContent)).toEqual(['악보 보기', '곡 올리기']);
  });
});

describe('악보 목록 실패·연결', () => {
  it('악보만 실패하면 곡은 그대로 보이고 한 줄 오류와 [다시 시도]를 보인다', async () => {
    const onSheetsRetry = vi.fn();
    const user = userEvent.setup();
    renderList('card', { sheets: [], sheetsFailed: true, onSheetsRetry });
    expect(screen.getByText('별빛 산책')).toBeTruthy();
    const line = screen.getByRole('alert');
    expect(line.textContent).toContain('악보를 불러오지 못했어요');
    await user.click(within(line).getByRole('button', { name: '다시 시도' }));
    expect(onSheetsRetry).toHaveBeenCalledOnce();
  });

  it('곡이 없어도 악보가 있으면 목록을 그린다', () => {
    renderList('card', { items: [] });
    expect(screen.getByText('합주 악보')).toBeTruthy();
  });

  it('곡에 붙은 악보는 따로 안 나온다', () => {
    renderList('card', { sheets: [sheet({ songId: 1 })] });
    expect(screen.queryByText('합주 악보')).toBeNull();
  });

  it('onSongSheet이 있으면 곡 ⋯ 메뉴에 sheetId 유무로 [악보 보기 | 악보 올리기]가 들어간다', async () => {
    const onSongSheet = vi.fn();
    const user = userEvent.setup();
    renderList('card', { sheets: [], items: [song({ id: 1, sheetId: null }), song({ id: 2, title: '둘째', sheetId: 9 })], onSongSheet });
    await user.click(screen.getByRole('button', { name: '별빛 산책 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '악보 올리기' }));
    expect(onSongSheet).toHaveBeenCalledWith('sheetUpload', expect.objectContaining({ id: 1 }));
    await user.click(screen.getByRole('button', { name: '둘째 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '악보 보기' }));
    expect(onSongSheet).toHaveBeenCalledWith('sheetView', expect.objectContaining({ id: 2 }));
  });

  it('onSongSheet이 없으면(스위치 꺼짐) 곡 ⋯ 메뉴에 악보 항목이 없다', async () => {
    const user = userEvent.setup();
    renderList('card', { sheets: [] });
    await user.click(screen.getByRole('button', { name: '별빛 산책 메뉴' }));
    expect(screen.queryByRole('menuitem', { name: /악보/ })).toBeNull();
  });
});
