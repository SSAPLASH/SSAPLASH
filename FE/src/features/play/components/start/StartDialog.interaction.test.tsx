// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartDialog, type StartDialogProps } from './StartDialog';

afterEach(cleanup);

function setup(over: Partial<StartDialogProps> = {}) {
  const props: StartDialogProps = {
    open: true,
    variant: 'play',
    song: { title: '별빛 산책', artist: '아티스트', bpm: 120, durationSec: 185, level: 'NORMAL' },
    modeLabel: '악보 연습',
    missing: [],
    connected: [true, true],
    countInBars: 1,
    options: <label><input type="checkbox" aria-label="옵션 하나" /></label>,
    onStart: vi.fn(),
    onSetup: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<StartDialog {...props} />);
  return props;
}

describe('StartDialog 판정 여유 한 줄', () => {
  it('넓힌 폭이 적용되는 판이면 「판정 여유 ±90ms」를 보인다', () => {
    setup({ goodMsNote: 90 });
    expect(screen.getByText('판정 여유 ±90ms')).toBeTruthy();
  });

  it('적용되지 않으면(null·생략) 아무것도 보이지 않는다', () => {
    setup({ goodMsNote: null });
    expect(screen.queryByText(/판정 여유/)).toBeNull();
    cleanup();
    setup();
    expect(screen.queryByText(/판정 여유/)).toBeNull();
  });
});

describe('StartDialog play', () => {
  it('곡 요약·옵션·안내·두 버튼이 보이고 ▶ 플레이에 초점이 간다', () => {
    setup();
    expect(screen.getByRole('dialog', { name: '별빛 산책' })).toBeTruthy();
    expect(screen.getByText(/악보 연습 · BPM 120 · 3:05/)).toBeTruthy();
    expect(screen.getByText('시작하면 5초 카운트다운과 준비 1마디 뒤 노트가 시작돼요.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '플레이' }));
  });

  it('카운트다운이 꺼져 있으면 안내가 바뀐다', () => {
    setup({ countInBars: 0 });
    expect(screen.getByText('시작하면 바로 노트가 시작돼요.')).toBeTruthy();
  });

  it('▶ 플레이 클릭은 onStart, 취소는 onClose', async () => {
    const p = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '플레이' }));
    expect(p.onStart).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('옵션 체크 줄에 초점이 있어도 Enter = 플레이', () => {
    const p = setup();
    const box = screen.getByLabelText('옵션 하나');
    box.focus();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(p.onStart).toHaveBeenCalledTimes(1);
  });

  it('옵션 줄의 스위치·선택 칸에 초점이 있어도 Enter = 플레이(스위치가 바뀌지 않는다)', () => {
    const onToggle = vi.fn();
    const p = setup({
      options: (
        <>
          <button type="button" role="switch" aria-checked="false" aria-label="메트로놈" onClick={onToggle} />
          <button type="button" role="radio" aria-checked="true" aria-label="자동" onClick={onToggle} />
        </>
      ),
    });
    for (const name of ['메트로놈', '자동']) {
      const el = screen.getByLabelText(name);
      el.focus();
      const notPrevented = fireEvent.keyDown(el, { key: 'Enter' });
      expect(notPrevented).toBe(false);
    }
    expect(p.onStart).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('스크림은 일시정지 창과 같은 모양의 클래스를 쓴다', () => {
    setup();
    expect(screen.getByRole('dialog').parentElement?.className).toBe('dialog-backdrop start-dialog-backdrop');
  });

  it('취소 버튼에 초점이 있을 때 Enter는 플레이로 새지 않는다', () => {
    const p = setup();
    const cancel = screen.getByRole('button', { name: '취소' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Enter' });
    expect(p.onStart).not.toHaveBeenCalled();
  });

  it('Esc는 닫기', () => {
    const p = setup();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('불러오는 중에는 플레이 버튼이 없고 Enter도 막는다', () => {
    const p = setup({ loading: true });
    expect(screen.queryByRole('button', { name: '플레이' })).toBeNull();
    expect(screen.getByLabelText('불러오는 중')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(p.onStart).not.toHaveBeenCalled();
  });

  it('오류면 문구와 [다시 시도], Enter는 막는다', async () => {
    const onRetry = vi.fn();
    const p = setup({ error: '채보를 불러오지 못했어요', onRetry });
    expect(screen.getByRole('alert').textContent).toContain('채보를 불러오지 못했어요');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(p.onStart).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('Tab은 창 안에서만 돈다', async () => {
    setup();
    const user = userEvent.setup();
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('open=false면 아무것도 그리지 않는다', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('StartDialog setup', () => {
  it('플레이 버튼 없이 빠진 항목과 [드럼 세팅으로]·[다시 연결]·[취소]만 보인다', async () => {
    const onReconnect = vi.fn();
    const p = setup({ variant: 'setup', missing: ['stick', 'firstSetup'], connected: [false, false], onReconnect });
    expect(screen.getByRole('dialog', { name: '기기 준비가 필요해요' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '플레이' })).toBeNull();
    expect(screen.getByText('왼손·오른손 연결 안 됨')).toBeTruthy();
    expect(screen.getByText('필요')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '드럼 세팅으로' }));
    expect(p.onSetup).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '다시 연결' }));
    expect(onReconnect).toHaveBeenCalled();
  });

  it('Enter는 아무것도 시작하지 않는다', () => {
    const p = setup({ variant: 'setup', missing: ['stick'] });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(p.onStart).not.toHaveBeenCalled();
  });

  it('onReconnect가 없으면 [다시 연결]이 없다', () => {
    setup({ variant: 'setup', missing: ['stick'] });
    expect(screen.queryByRole('button', { name: '다시 연결' })).toBeNull();
  });
});
