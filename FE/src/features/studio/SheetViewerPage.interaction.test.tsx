// @vitest-environment happy-dom
// 악보 뷰어 (설계 CHART-001 악보 보관 4-3~4-5). 이미지 쪽 넘김·몰입 모드·없는 악보/일시 오류·만료 갱신·제목 수정·삭제·스위치 꺼짐.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteSheet, getSheet, updateSheetTitle } from '@/features/studio/api/sheets';
import { SheetError, type SheetDetail } from '@/features/studio/domain/sheetMusic';

const flags = vi.hoisted(() => ({ archive: true }));
vi.mock('@/config/features', () => ({
  get SHEET_ARCHIVE_ENABLED() {
    return flags.archive;
  },
}));
vi.mock('@/features/studio/api/sheets', () => ({ getSheet: vi.fn(), updateSheetTitle: vi.fn(), deleteSheet: vi.fn() }));
// pdf.js는 happy-dom에서 돌지 않는다. 쪽 수·보이는 쪽 보고만 흉내 낸다
vi.mock('@/features/studio/components/sheet/PdfPages', () => ({
  PdfPages: (p: { url: string; onVisiblePage: (n: number) => void; onTap?: () => void }) => (
    <div data-testid="pdf" data-url={p.url} onClick={p.onTap}>
      <button type="button" onClick={() => p.onVisiblePage(2)}>
        2쪽으로
      </button>
    </div>
  ),
}));

const NOW = 1_700_000_000_000;
const detail = (over: Partial<SheetDetail> = {}): SheetDetail => ({
  id: 5, title: '내 악보', kind: 'IMAGE', pageCount: 3, thumbnailUrl: null, createdAt: '', songId: null,
  pages: [1, 2, 3].map((n) => ({ pageNo: n, url: `https://cdn/p${n}.png`, contentType: 'image/png', width: 0, height: 0 })),
  expiresAt: NOW + 60 * 60 * 1000, ...over,
});
const withSuffix = (d: SheetDetail, suffix: string): SheetDetail => ({ ...d, pages: d.pages.map((p) => ({ ...p, url: p.url + suffix })) });

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + ':' + JSON.stringify(l.state)}</div>;
}
async function show(path = '/studio/sheets/5') {
  const { SheetViewerPage } = await import('./SheetViewerPage');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studio/sheets/:id" element={<SheetViewerPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
const counter = () => document.querySelector('.sheet-viewer-bar .sheet-counter')?.textContent;
const area = () => screen.getByTestId('sheet-image-area');

beforeEach(() => {
  flags.archive = true;
  vi.mocked(getSheet).mockReset().mockResolvedValue(detail());
  vi.mocked(updateSheetTitle).mockReset();
  vi.mocked(deleteSheet).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SheetViewerPage', () => {
  it('상세를 읽는 동안 뷰어 안에 로딩을 보이고, 이어서 1쪽과 바(제목·종류·n/m)를 보인다', async () => {
    await show();
    expect(screen.getByRole('status').textContent).toContain('불러오는 중');
    await screen.findByRole('img', { name: '내 악보 1쪽' });
    expect(screen.getByRole('heading', { name: '내 악보' })).toBeTruthy();
    expect(screen.getByText('이미지')).toBeTruthy();
    expect(counter()).toBe('1/3');
    expect(screen.getByText('1 / 3쪽')).toBeTruthy();
  });

  it('← → 키로 쪽을 넘기고 처음·끝을 넘지 않는다', async () => {
    await show();
    await screen.findByRole('img', { name: '내 악보 1쪽' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter()).toBe('1/3');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe('3/3');
    expect(screen.getByRole('img', { name: '내 악보 3쪽' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter()).toBe('2/3');
  });

  it('좌우 밀기와 가장자리 탭으로 넘기고, 가운데 탭은 몰입 모드를 바꾼다', async () => {
    await show();
    await screen.findByRole('img', { name: '내 악보 1쪽' });
    // happy-dom은 폭이 0이라 창 폭(1024)을 기준으로 본다
    const tap = (x: number) => {
      fireEvent.pointerDown(area(), { clientX: x, clientY: 100 });
      fireEvent.pointerUp(area(), { clientX: x, clientY: 100 });
    };
    tap(1000); // 오른쪽 가장자리 → 다음
    expect(counter()).toBe('2/3');
    tap(10); // 왼쪽 가장자리 → 이전
    expect(counter()).toBe('1/3');
    fireEvent.pointerDown(area(), { clientX: 600, clientY: 100 });
    fireEvent.pointerUp(area(), { clientX: 300, clientY: 110 }); // 왼쪽으로 밀기 → 다음
    expect(counter()).toBe('2/3');
    const root = document.querySelector('.sheet-viewer') as HTMLElement;
    expect(root.dataset.immersive).toBe('false');
    tap(500);
    expect(root.dataset.immersive).toBe('true');
    // 몰입 모드에서도 n/m은 남는다
    expect(screen.getByTestId('sheet-counter-float').textContent).toBe('2/3');
    tap(500);
    expect(root.dataset.immersive).toBe('false');
  });

  it('다음 쪽 그림을 미리 받아 둔다', async () => {
    const srcs: string[] = [];
    class Spy {
      set src(v: string) {
        srcs.push(v);
      }
    }
    vi.stubGlobal('Image', Spy);
    await show();
    await screen.findByRole('img', { name: '내 악보 1쪽' });
    expect(srcs).toContain('https://cdn/p2.png');
  });

  it('PDF는 PdfPages로 그리고, 보이는 쪽 번호를 바 n/m에 보인다', async () => {
    vi.mocked(getSheet).mockResolvedValue(
      detail({ kind: 'PDF', pageCount: 4, pages: [{ pageNo: 1, url: 'https://cdn/a.pdf', contentType: 'application/pdf', width: 0, height: 0 }] }),
    );
    await show();
    const pdf = await screen.findByTestId('pdf');
    expect(pdf.dataset.url).toBe('https://cdn/a.pdf');
    expect(screen.getByText('PDF')).toBeTruthy();
    expect(counter()).toBe('1/4');
    fireEvent.click(screen.getByRole('button', { name: '2쪽으로' }));
    expect(counter()).toBe('2/4');
  });

  it('404 SHEET_NOT_FOUND면 없는 악보 안내와 [라이브러리로]를 보이고 누르면 /studio로 간다', async () => {
    vi.mocked(getSheet).mockRejectedValue(new SheetError('SHEET_NOT_FOUND', 404));
    await show();
    await screen.findByText('지워졌거나 주소가 틀렸어요');
    await userEvent.click(screen.getByRole('button', { name: '라이브러리로' }));
    expect(screen.getByTestId('where').textContent).toContain('/studio');
  });

  it('503·네트워크 오류면 [다시 시도]를 보이고, 누르면 다시 읽는다', async () => {
    vi.mocked(getSheet).mockRejectedValueOnce(new SheetError('SHEET_UNAVAILABLE', 503)).mockResolvedValue(detail());
    await show();
    await userEvent.click(await screen.findByRole('button', { name: '다시 시도' }));
    await screen.findByRole('img', { name: '내 악보 1쪽' });
    expect(getSheet).toHaveBeenCalledTimes(2);
  });

  it('그림 읽기에 실패하면 상세를 한 번 다시 읽고, 또 실패하면 일시 오류를 보인다', async () => {
    await show();
    const img = await screen.findByRole('img', { name: '내 악보 1쪽' });
    vi.mocked(getSheet).mockResolvedValueOnce(withSuffix(detail(), '?v2'));
    fireEvent.error(img);
    await waitFor(() => expect(screen.getByRole('img', { name: '내 악보 1쪽' }).getAttribute('src')).toBe('https://cdn/p1.png?v2'));
    expect(getSheet).toHaveBeenCalledTimes(2);
    fireEvent.error(screen.getByRole('img', { name: '내 악보 1쪽' }));
    await screen.findByRole('button', { name: '다시 시도' });
    expect(getSheet).toHaveBeenCalledTimes(2);
  });

  it('만료 2분 전에 상세를 다시 읽고 보던 쪽을 유지한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    // 3분 뒤 만료 → 1분 뒤 갱신
    vi.mocked(getSheet).mockResolvedValueOnce(detail({ expiresAt: NOW + 3 * 60 * 1000 }));
    await show();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('img', { name: '내 악보 1쪽' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe('2/3');
    vi.mocked(getSheet).mockResolvedValueOnce(withSuffix(detail({ expiresAt: NOW + 70 * 60 * 1000 }), '?v2'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(getSheet).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32_000);
    });
    expect(getSheet).toHaveBeenCalledTimes(2);
    expect(counter()).toBe('2/3');
    expect(screen.getByRole('img', { name: '내 악보 2쪽' }).getAttribute('src')).toBe('https://cdn/p2.png?v2');
  });

  it('제목 수정: ⋯ → 제목 수정 → 저장하면 바 제목이 바뀐다', async () => {
    vi.mocked(updateSheetTitle).mockResolvedValue(detail({ title: '새 제목' }));
    await show();
    await screen.findByRole('img', { name: '내 악보 1쪽' });
    await userEvent.click(screen.getByRole('button', { name: '내 악보 메뉴' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '제목 수정' }));
    const input = screen.getByLabelText(/악보 제목/);
    await userEvent.clear(input);
    await userEvent.type(input, '새 제목');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '새 제목' })).toBeTruthy());
    expect(updateSheetTitle).toHaveBeenCalledWith(5, '새 제목');
  });

  it('삭제: 확인하면 /studio로 가며 state에 sheetDeleted를 싣는다', async () => {
    vi.mocked(deleteSheet).mockResolvedValue(undefined);
    await show();
    await screen.findByRole('img', { name: '내 악보 1쪽' });
    await userEvent.click(screen.getByRole('button', { name: '내 악보 메뉴' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '악보 삭제' }));
    await userEvent.click(screen.getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/studio:{"sheetDeleted":true}'));
    expect(deleteSheet).toHaveBeenCalledWith(5);
  });

  it('뒤로: 기록이 없으면 /studio로 간다', async () => {
    await show();
    await screen.findByRole('img', { name: '내 악보 1쪽' });
    await userEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByTestId('where').textContent).toContain('/studio');
  });

  it('악보 스위치가 꺼져 있으면 /studio로 보내고 조회하지 않는다', async () => {
    flags.archive = false;
    await show();
    expect(screen.getByTestId('where').textContent).toContain('/studio');
    expect(getSheet).not.toHaveBeenCalled();
  });

  it('숫자가 아닌 id는 없는 악보로 본다', async () => {
    await show('/studio/sheets/abc');
    await screen.findByText('지워졌거나 주소가 틀렸어요');
    expect(getSheet).not.toHaveBeenCalled();
  });
});
