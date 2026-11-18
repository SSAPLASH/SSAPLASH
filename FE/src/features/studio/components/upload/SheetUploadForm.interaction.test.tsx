// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { uploadSheet } from '@/features/studio/api/sheets';
import { SheetError } from '@/features/studio/domain/sheetMusic';
import { SheetUploadForm } from './SheetUploadForm';

vi.mock('@/features/studio/api/sheets', () => ({ uploadSheet: vi.fn() }));
const upload = vi.mocked(uploadSheet);

const img = (name = 'a.png') => new File(['x'], name, { type: 'image/png' });
const pdf = (name = 'a.pdf') => new File(['x'], name, { type: 'application/pdf' });

beforeEach(() => {
  upload.mockReset();
});
afterEach(cleanup);

function setup(props: Partial<Parameters<typeof SheetUploadForm>[0]> = {}) {
  const onBusyChange = vi.fn();
  const onUploaded = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  render(<SheetUploadForm onBusyChange={onBusyChange} onUploaded={onUploaded} onCancel={onCancel} {...props} />);
  const input = screen.getByLabelText('악보 파일 선택') as HTMLInputElement;
  const submit = () => screen.getByRole('button', { name: /^(올리기|올리는 중…)$/ }) as HTMLButtonElement;
  return { user, input, submit, onBusyChange, onUploaded, onCancel };
}

describe('SheetUploadForm', () => {
  it('파일이 없거나 제목이 비면 [올리기]가 막힌다. 첫 파일명이 제목 기본값이 된다', async () => {
    const { user, input, submit } = setup();
    expect(submit().disabled).toBe(true);
    await user.upload(input, img('합주 악보.png'));
    expect((screen.getByLabelText(/악보 제목/) as HTMLInputElement).value).toBe('합주 악보');
    expect(submit().disabled).toBe(false);
    await user.clear(screen.getByLabelText(/악보 제목/));
    expect(submit().disabled).toBe(true);
  });

  it('이미지와 PDF를 섞으면 요청 없이 오류 한 곳에 원인 문구를 보이고 입력은 유지한다', async () => {
    const { user, input, submit } = setup();
    await user.upload(input, [img('a.png'), pdf('b.pdf')]);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe('이미지와 PDF를 함께 올릴 수 없어요');
    expect(submit().disabled).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByText(/a\.png/)).toBeTruthy();
    // [빼기]로 PDF를 빼면 오류가 사라진다
    await user.click(screen.getByRole('button', { name: 'b.pdf 빼기' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('고른 장수를 n/20으로 보인다', async () => {
    const { user, input } = setup();
    await user.upload(input, [img('1.png'), img('2.png'), img('3.png')]);
    expect(screen.getByLabelText('고른 장수').textContent).toBe('3/20');
  });

  it('21장이면 장수 초과 문구', async () => {
    const { user, input } = setup();
    await user.upload(
      input,
      Array.from({ length: 21 }, (_, i) => img(`${i}.png`)),
    );
    expect(screen.getByRole('alert').textContent).toBe('이미지는 20장까지, PDF는 1개만 올릴 수 있어요');
  });

  it('헤더에서 열면 songId 없이 올린다', async () => {
    upload.mockResolvedValue({} as never);
    const { user, input, submit, onUploaded } = setup();
    await user.upload(input, [img('1.png'), img('2.png')]);
    await user.click(submit());
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    const arg = upload.mock.calls[0][0];
    expect(arg.songId ?? null).toBeNull();
    expect(arg.title).toBe('1');
    expect(arg.files).toHaveLength(2);
  });

  it('곡에서 열면 안내와 곡 제목 기본값, songId를 보낸다', async () => {
    upload.mockResolvedValue({} as never);
    const { user, input, submit, onUploaded } = setup({ target: { id: 7, title: '별빛 산책' } });
    expect(screen.getByText('「별빛 산책」에 붙일 악보')).toBeTruthy();
    expect((screen.getByLabelText(/악보 제목/) as HTMLInputElement).value).toBe('별빛 산책');
    await user.upload(input, pdf());
    await user.click(submit());
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(upload.mock.calls[0][0]).toMatchObject({ songId: 7, title: '별빛 산책' });
  });

  it('올리는 동안 입력을 잠그고 「올리는 중…」을 보이며 busy를 알린다', async () => {
    let finish: (v?: unknown) => void = () => {};
    upload.mockReturnValue(new Promise((r) => (finish = r)) as never);
    const { user, input, submit, onBusyChange, onUploaded } = setup();
    await user.upload(input, img());
    await user.click(submit());
    expect(submit().textContent).toBe('올리는 중…');
    expect(submit().disabled).toBe(true);
    expect(input.disabled).toBe(true);
    expect((screen.getByLabelText(/악보 제목/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '취소' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'a.png 빼기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    finish({});
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('BE 오류는 같은 오류 자리에 문구로 보이고 입력은 유지한다', async () => {
    upload.mockImplementation(async () => {
      throw new SheetError('SHEET_ALREADY_LINKED', 409);
    });
    const { user, input, submit, onUploaded } = setup({ target: { id: 7, title: '별빛 산책' } });
    await user.upload(input, img());
    await user.click(submit());
    expect((await screen.findByRole('alert')).textContent).toBe('이 곡에는 이미 악보가 있어요');
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.getByText(/a\.png/)).toBeTruthy();
    expect(submit().disabled).toBe(false);
  });

  it('404 SONG_NOT_FOUND 문구', async () => {
    upload.mockImplementation(async () => {
      throw new SheetError('SONG_NOT_FOUND', 404);
    });
    const { user, input, submit } = setup({ target: { id: 7, title: 'x' } });
    await user.upload(input, img());
    await user.click(submit());
    expect((await screen.findByRole('alert')).textContent).toBe('곡을 찾을 수 없어요. 목록을 새로 고쳐 주세요');
  });
});
