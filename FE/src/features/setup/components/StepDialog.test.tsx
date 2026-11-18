// @vitest-environment happy-dom
// 단계 팝업 틀(PLAY-004 D8): 제목·본문·[닫기] 렌더, 닫으면 포커스가 연 타일로 돌아온다
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepDialog } from './StepDialog';

afterEach(cleanup);

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        타일
      </button>
      {open && (
        <StepDialog title="스틱 연결" titleId="t" onClose={() => setOpen(false)}>
          <p>본문 내용</p>
        </StepDialog>
      )}
    </>
  );
}

describe('StepDialog', () => {
  it('제목·본문·[닫기]가 dialog 역할 요소 안에 그려진다', () => {
    render(
      <StepDialog title="시작 위치 보정" titleId="t" onClose={() => {}}>
        <p>본문 내용</p>
      </StepDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: '시작 위치 보정' });
    expect(dialog.textContent).toContain('본문 내용');
    expect(screen.getByRole('button', { name: '닫기' })).toBeTruthy();
  });

  it('[닫기]를 누르면 onClose를 부른다', () => {
    const onClose = vi.fn();
    render(
      <StepDialog title="t" titleId="t" onClose={onClose}>
        x
      </StepDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('닫으면 포커스가 팝업을 연 타일로 돌아간다', () => {
    render(<Host />);
    const tile = screen.getByRole('button', { name: '타일' });
    tile.focus();
    fireEvent.click(tile);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(tile);
  });
});
