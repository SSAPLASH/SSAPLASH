// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllAdminSongs, registerAdminSong, uploadAccompaniment } from './adminSongs';
import type { AdminSong } from './adminSong';
import { useAdminBulk } from './adminBulkStore';
import { useAdminSongs } from './adminSongStore';
import { AdminSongsPage } from './AdminSongsPage';

vi.mock('./adminSongs', () => ({ listAllAdminSongs: vi.fn(), registerAdminSong: vi.fn(), uploadAccompaniment: vi.fn() }));

const song = (over: Partial<AdminSong>): AdminSong => ({
  id: 1, title: 'x', artist: null, license: 'x', status: 'READY', hasAccompaniment: false, published: true, difficulties: [], ...over,
});

const CSV =
  '\uFEFF곡 폴더,아티스트,제목,MIDI,드럼리스 MR,offsetMs\n' +
  'billie_jean,Michael Jackson,Billie Jean,billie_jean.mid,billie_jean_drumless.flac,1226\n' +
  'new,새 가수,새 곡,new.mid,new.mp3,0\n' +
  'bad,,깨진 곡,missing.mid,,\n';

async function openBulk() {
  render(<MemoryRouter><AdminSongsPage /></MemoryRouter>);
  await screen.findByRole('table', { name: '공용 곡' });
  fireEvent.click(screen.getByRole('button', { name: '일괄 추가' }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  vi.mocked(listAllAdminSongs).mockReset().mockResolvedValue([song({ id: 5, title: 'Billie Jean' })]);
  vi.mocked(registerAdminSong).mockReset().mockResolvedValue(song({ id: 9, title: '새 곡' }));
  vi.mocked(uploadAccompaniment).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  useAdminSongs.getState().resetForTest();
  useAdminBulk.getState().reset();
  vi.restoreAllMocks();
});

describe('CSV 일괄 추가', () => {
  it('양식 받기는 BOM 붙은 CSV를 내려준다', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const dialog = await openBulk();
    fireEvent.click(within(dialog).getByRole('button', { name: '양식 받기' }));
    const blob = create.mock.calls[0][0] as Blob;
    // 기본 TextDecoder는 BOM을 지우므로 남겨서 확인한다
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer());
    expect(text.startsWith('\uFEFF제목,아티스트,MIDI,드럼리스 MR,offsetMs,라이선스,공개')).toBe(true);
  });

  it('AI 표와 파일을 고르면 미리보기로 판정하고, 업로드하면 오류 줄은 빼고 차례로 올린 뒤 목록을 다시 읽는다', async () => {
    const dialog = await openBulk();
    fireEvent.change(within(dialog).getByLabelText('CSV 파일'), { target: { files: [new File([CSV], '곡별_첫박.csv', { type: 'text/csv' })] } });
    const mp3 = new File(['a'], 'billie_jean.mp3', { type: 'audio/mpeg' });
    const midi = new File(['m'], 'new.mid');
    const newMp3 = new File(['b'], 'new.mp3', { type: 'audio/mpeg' });
    // 파일을 두 번에 나눠 골라도 앞에서 고른 파일이 남는다
    fireEvent.change(within(dialog).getByLabelText('MIDI·반주 파일'), { target: { files: [mp3, midi] } });
    fireEvent.change(within(dialog).getByLabelText('MIDI·반주 파일'), { target: { files: [newMp3] } });
    expect(within(dialog).getByText('3개 골랐어요')).toBeTruthy();

    const preview = await within(dialog).findByRole('table', { name: '일괄 추가 미리보기' });
    const rows = within(preview).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual(['반주만', '등록', '오류']);
    expect(within(rows[2]).getByText(/missing\.mid/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '업로드 (2곡)' }));
    await waitFor(() => expect(within(dialog).getByText(/완료 2 · 실패 0 · 건너뜀 1/)).toBeTruthy());
    expect(uploadAccompaniment).toHaveBeenCalledWith(5, mp3);
    expect(vi.mocked(registerAdminSong).mock.calls[0][0]).toMatchObject({ title: '새 곡', offsetMs: '0', file: midi, accompaniment: newMp3 });
    expect(uploadAccompaniment).toHaveBeenCalledWith(9, newMp3);
    await waitFor(() => expect(listAllAdminSongs).toHaveBeenCalledTimes(2));
    // 끝난 뒤에도 미리보기 「할 일」은 실행할 때 그대로다(목록을 다시 읽어도 바뀌지 않는다)
    const after = within(within(dialog).getByRole('table', { name: '일괄 추가 미리보기' })).getAllByRole('row').slice(1);
    expect(after.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual(['반주만', '등록', '오류']);
  });

  it('실패한 줄이 있으면 [남은 줄 다시 확인]으로 새로 판정해 다시 올릴 수 있다', async () => {
    vi.mocked(uploadAccompaniment).mockRejectedValueOnce(new Error('offline'));
    const dialog = await openBulk();
    fireEvent.change(within(dialog).getByLabelText('CSV 파일'), { target: { files: [new File(['제목,MIDI,드럼리스 MR\nBillie Jean,,billie_jean.mp3\n'], 'a.csv')] } });
    fireEvent.change(within(dialog).getByLabelText('MIDI·반주 파일'), { target: { files: [new File(['a'], 'billie_jean.mp3', { type: 'audio/mpeg' })] } });
    fireEvent.click(await within(dialog).findByRole('button', { name: '업로드 (1곡)' }));
    await waitFor(() => expect(within(dialog).getByText(/실패 1/)).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: '남은 줄 다시 확인' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '업로드 (1곡)' }));
    await waitFor(() => expect(uploadAccompaniment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).getByText(/완료 1 · 실패 0/)).toBeTruthy());
  });

  it('업로드 중에는 새로고침·닫기 전에 경고한다', async () => {
    let release: () => void = () => {};
    vi.mocked(uploadAccompaniment).mockReturnValueOnce(new Promise<void>((r) => (release = r)));
    const dialog = await openBulk();
    fireEvent.change(within(dialog).getByLabelText('CSV 파일'), { target: { files: [new File(['제목,MIDI,드럼리스 MR\nBillie Jean,,billie_jean.mp3\n'], 'a.csv')] } });
    fireEvent.change(within(dialog).getByLabelText('MIDI·반주 파일'), { target: { files: [new File(['a'], 'billie_jean.mp3', { type: 'audio/mpeg' })] } });
    fireEvent.click(await within(dialog).findByRole('button', { name: '업로드 (1곡)' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '업로드 중…' })).toBeTruthy());
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    release();
    await waitFor(() => expect(within(dialog).getByText(/완료 1/)).toBeTruthy());
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
