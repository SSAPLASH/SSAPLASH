// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetError } from '@/features/studio/domain/sheetMusic';
import { SheetDeleteDialog } from './SheetDeleteDialog';
import { SheetTitleDialog } from './SheetTitleDialog';

afterEach(cleanup);

describe('SheetTitleDialog', () => {
  it('제목이 그대로면 [저장]이 막히고, 고치면 공백을 뺀 제목으로 onSubmit 뒤 닫는다', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_t: string) => {});
    const onClose = vi.fn();
    render(<SheetTitleDialog title="옛 제목" onSubmit={onSubmit} onClose={onClose} />);
    const save = screen.getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const input = screen.getByLabelText(/악보 제목/);
    await user.clear(input);
    expect(save.disabled).toBe(true);
    expect(screen.getByText('제목을 입력해 주세요')).toBeTruthy();
    await user.type(input, '  새 제목 ');
    await user.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith('새 제목');
  });

  it('101자는 막는다', async () => {
    const user = userEvent.setup();
    render(<SheetTitleDialog title="a" onSubmit={async () => {}} onClose={() => {}} />);
    const input = screen.getByLabelText(/악보 제목/);
    await user.clear(input);
    await user.click(input);
    await user.paste('가'.repeat(101));
    expect((screen.getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('실패하면 창 안에 문구를 보이고 입력을 유지하며 닫지 않는다', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn(async () => {
      throw new SheetError('SHEET_INVALID', 400);
    });
    render(<SheetTitleDialog title="a" onSubmit={onSubmit} onClose={onClose} />);
    const input = screen.getByLabelText(/악보 제목/);
    await user.type(input, 'b');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect((await screen.findByRole('alert')).textContent).toBe('파일을 읽을 수 없어요. 다른 파일로 올려 주세요');
    expect(onClose).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('ab');
    expect((screen.getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('SheetDeleteDialog', () => {
  it('제목을 묻고 [삭제]를 누르면 onConfirm 뒤 닫는다', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<SheetDeleteDialog title="합주 악보" onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByText('「합주 악보」을 삭제할까요?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('삭제 중에는 버튼이 잠기고, 실패하면 문구를 보이며 닫지 않는다', async () => {
    const user = userEvent.setup();
    let reject: (e: unknown) => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((_, rej) => {
          reject = rej;
        }),
    );
    const onClose = vi.fn();
    render(<SheetDeleteDialog title="a" onConfirm={onConfirm} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: '삭제' }));
    expect((screen.getByRole('button', { name: '삭제 중…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '취소' }) as HTMLButtonElement).disabled).toBe(true);
    reject(new SheetError('SHEET_UNAVAILABLE', 503));
    expect((await screen.findByRole('alert')).textContent).toBe('지금은 올릴 수 없어요. 잠시 뒤 다시 시도해 주세요');
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '삭제' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
