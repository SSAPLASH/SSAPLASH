// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllAdminSongs, registerAdminSong, uploadAccompaniment } from './adminSongs';
import { RequireAdmin } from '@/components/shell/account/RequireAdmin';
import { Sidebar } from '@/components/shell/nav/Sidebar';
import type { AdminSong } from './adminSong';
import type { UserRole } from '@/domain/account/auth';
import { useAdminSongs } from './adminSongStore';
import { useAuth } from '@/store/authStore';
import { AdminSongsPage } from './AdminSongsPage';

vi.mock('./adminSongs', () => ({ listAllAdminSongs: vi.fn(), registerAdminSong: vi.fn(), uploadAccompaniment: vi.fn() }));

const song = (over: Partial<AdminSong> = {}): AdminSong => ({
  id: 1, title: 'Billie Jean', artist: 'Michael Jackson', license: 'x', status: 'READY',
  hasAccompaniment: false, published: true, difficulties: ['EASY', 'NORMAL', 'HARD'], ...over,
});

const loginAs = (role: UserRole) =>
  useAuth.setState({ status: 'authenticated', user: { id: 1, role } as NonNullable<ReturnType<typeof useAuth.getState>['user']> });

function showAdminRoute() {
  return render(
    <MemoryRouter initialEntries={['/admin/songs']}>
      <Routes>
        <Route element={<RequireAdmin />}>
          <Route path="admin/songs" element={<AdminSongsPage />} />
        </Route>
        <Route path="free" element={<p>자유 연습 화면</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(listAllAdminSongs).mockReset().mockResolvedValue([song(), song({ id: 2, title: '거울', artist: '국카스텐', hasAccompaniment: true })]);
  vi.mocked(registerAdminSong).mockReset();
  vi.mocked(uploadAccompaniment).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  useAdminSongs.getState().resetForTest();
  useAuth.setState({ status: 'unknown', user: null });
});

describe('관리자 권한 표시', () => {
  it('일반 회원은 사이드바에 공용 곡 관리가 없고 주소로 들어오면 자유 연습으로 간다', () => {
    loginAs('USER');
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: '공용 곡 관리' })).toBeNull();
    cleanup();
    showAdminRoute();
    expect(screen.getByText('자유 연습 화면')).toBeTruthy();
    expect(listAllAdminSongs).not.toHaveBeenCalled();
  });

  it('관리자는 사이드바 항목이 /admin/songs로 간다', () => {
    loginAs('ADMIN');
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '공용 곡 관리' }).getAttribute('href')).toBe('/admin/songs');
  });
});

describe('공용 곡 관리 화면', () => {
  it('공용 곡 표에 반주 상태와 행별 버튼을 보여 준다', async () => {
    loginAs('ADMIN');
    showAdminRoute();
    const table = await screen.findByRole('table', { name: '공용 곡' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Billie Jean')).toBeTruthy();
    expect(within(rows[0]).getByText('없음')).toBeTruthy();
    expect(within(rows[0]).getByRole('button', { name: 'Billie Jean 반주 올리기' })).toBeTruthy();
    expect(within(rows[1]).getByRole('button', { name: '거울 반주 교체' })).toBeTruthy();
  });

  it('행에서 반주 파일을 고르면 그 곡에 올리고 있음으로 바뀐다', async () => {
    loginAs('ADMIN');
    showAdminRoute();
    await screen.findByRole('table', { name: '공용 곡' });
    const input = screen.getByLabelText('Billie Jean 반주 파일') as HTMLInputElement;
    const file = new File(['x'], 'billie_jean.mp3', { type: 'audio/mpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadAccompaniment).toHaveBeenCalledWith(1, file));
    const row = screen.getByText('Billie Jean').closest('tr') as HTMLElement;
    await waitFor(() => expect(within(row).getByText('있음')).toBeTruthy());
  });

  it('공용 곡 추가 창은 필수값이 없으면 등록할 수 없고, 채우면 offsetMs와 함께 등록한다', async () => {
    loginAs('ADMIN');
    vi.mocked(registerAdminSong).mockResolvedValue(song({ id: 3, title: '새 곡' }));
    showAdminRoute();
    await screen.findByRole('table', { name: '공용 곡' });
    fireEvent.click(screen.getByRole('button', { name: '공용 곡 추가' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: '등록' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('MIDI 파일'), { target: { files: [new File(['m'], 'new_song.mid')] } });
    fireEvent.change(within(dialog).getByLabelText('곡 제목 *'), { target: { value: '새 곡' } });
    fireEvent.change(within(dialog).getByLabelText('출처·라이선스 *'), { target: { value: '자작' } });
    fireEvent.change(within(dialog).getByLabelText('첫 박 시각 ms (선택)'), { target: { value: '-1' } });
    expect(submit.disabled).toBe(true);
    expect(within(dialog).getByRole('alert').textContent).toContain('첫 박 시각');

    fireEvent.change(within(dialog).getByLabelText('첫 박 시각 ms (선택)'), { target: { value: '1226' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(registerAdminSong).toHaveBeenCalledTimes(1));
    expect(vi.mocked(registerAdminSong).mock.calls[0][0]).toMatchObject({ title: '새 곡', license: '자작', offsetMs: '1226', published: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
