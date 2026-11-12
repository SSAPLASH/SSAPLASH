// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SKIP_MS } from '@/domain/song/freeAccompaniment';
import { PlaybackTransport } from './PlaybackTransport';

afterEach(cleanup);

const setup = (over: Partial<React.ComponentProps<typeof PlaybackTransport>> = {}) => {
  const onToggle = vi.fn();
  const onSkip = vi.fn();
  const view = render(
    <PlaybackTransport playing={false} playLabel="재생" pauseLabel="일시정지" onToggle={onToggle} onSkip={onSkip} {...over} />,
  );
  return { onToggle, onSkip, ...view };
};

describe('PlaybackTransport', () => {
  it('10초 뒤로·앞으로는 ∓SKIP_MS로 onSkip을 부른다', () => {
    const { onSkip } = setup();
    fireEvent.click(screen.getByRole('button', { name: '10초 뒤로' }));
    expect(onSkip).toHaveBeenLastCalledWith(-SKIP_MS);
    fireEvent.click(screen.getByRole('button', { name: '10초 앞으로' }));
    expect(onSkip).toHaveBeenLastCalledWith(SKIP_MS);
  });

  it('재생 중이면 일시정지 라벨·글리프, 아니면 재생 라벨·글리프로 바뀌고 onToggle을 부른다', () => {
    const { onToggle, container, rerender } = setup();
    expect(screen.getByRole('button', { name: '재생' })).toBeTruthy();
    expect(container.querySelector('.playback-glyph path')?.getAttribute('d')).toContain('M8.75 5.625V24.375');
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<PlaybackTransport playing playLabel="재생" pauseLabel="일시정지" onToggle={onToggle} onSkip={() => {}} />);
    expect(screen.getByRole('button', { name: '일시정지' })).toBeTruthy();
    expect(container.querySelectorAll('.playback-glyph path')).toHaveLength(2);
  });

  it('disabled면 세 버튼이 모두 비활성', () => {
    setup({ disabled: true });
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('skips=false면 10초 버튼 대신 빈 자리 둘만 둔다', () => {
    const { container } = setup({ skips: false });
    expect(screen.queryByRole('button', { name: '10초 뒤로' })).toBeNull();
    expect(screen.queryByRole('button', { name: '10초 앞으로' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(container.querySelectorAll('.playback-skip-gap')).toHaveLength(2);
  });

  it('showBack=false면 10초 뒤로를 그리지 않는다', () => {
    setup({ showBack: false });
    expect(screen.queryByRole('button', { name: '10초 뒤로' })).toBeNull();
    expect(screen.getByRole('button', { name: '10초 앞으로' })).toBeTruthy();
  });

  it('10초 버튼을 누르면 해당 방향 회전 클래스가 붙는다', () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole('button', { name: '10초 앞으로' }));
    expect(container.querySelector('.playback-icon.is-spin-forward')).toBeTruthy();
    expect(container.querySelector('.playback-icon.is-spin-back')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '10초 뒤로' }));
    expect(container.querySelector('.playback-icon.is-spin-back')).toBeTruthy();
  });

  it('라벨을 바꿀 수 있다', () => {
    setup({ backLabel: '뒤로', forwardLabel: '앞으로' });
    expect(screen.getByRole('button', { name: '뒤로' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '앞으로' })).toBeTruthy();
  });
});
