// @vitest-environment happy-dom
// 상호작용 테스트 환경 검증용: happy-dom + testing-library + userEvent가 MotionProvider 아래에서 동작하는지 확인한다.
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m } from 'motion/react';
import MotionProvider from './MotionProvider';

afterEach(cleanup);

function Toggle() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)}>
        토글
      </button>
      <m.div data-testid="panel" data-open={open} />
    </div>
  );
}

describe('MotionProvider 상호작용', () => {
  it('버튼 클릭으로 상태가 바뀐다', async () => {
    const user = userEvent.setup();
    render(
      <MotionProvider>
        <Toggle />
      </MotionProvider>,
    );
    const panel = screen.getByTestId('panel');
    expect(panel.getAttribute('data-open')).toBe('false');
    await user.click(screen.getByRole('button', { name: '토글' }));
    expect(panel.getAttribute('data-open')).toBe('true');
  });
});
