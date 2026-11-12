// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineError } from './InlineError';

describe('InlineError', () => {
  afterEach(cleanup);

  it('기본은 캡슐 모양이고 onRetry가 없으면 버튼이 없다', () => {
    render(<InlineError>기록을 찾을 수 없습니다.</InlineError>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toBe('ui-inline-error is-pill');
    expect(alert.textContent).toBe('기록을 찾을 수 없습니다.');
    expect(alert.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('onRetry가 있으면 글자 버튼을 그리고 누르면 부른다', async () => {
    const onRetry = vi.fn();
    render(<InlineError onRetry={onRetry}>불러오지 못했어요.</InlineError>);
    const button = screen.getByRole('button', { name: '다시 시도' });
    expect(button.className).toContain('ui-btn-text');
    await userEvent.setup().click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retryLabel', () => {
    render(
      <InlineError onRetry={() => {}} retryLabel="다시 저장">
        저장하지 못했어요.
      </InlineError>,
    );
    expect(screen.getByRole('button', { name: '다시 저장' })).toBeTruthy();
  });

  it('plain이면 캡슐 바탕·아이콘을 쓰지 않는다', () => {
    render(
      <InlineError plain className="play-sd-error" title="자세한 사유">
        곡 정보를 불러오지 못했어요.
      </InlineError>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.className).toBe('ui-inline-error is-plain play-sd-error');
    expect(alert.querySelector('svg')).toBeNull();
    expect(alert.getAttribute('title')).toBe('자세한 사유');
  });

  it('size lg면 큰 캡슐 클래스가 붙고, plain에는 붙지 않는다', () => {
    const { unmount } = render(<InlineError size="lg">불러오지 못했어요.</InlineError>);
    expect(screen.getByRole('alert').className).toBe('ui-inline-error is-pill is-lg');
    unmount();
    render(
      <InlineError size="lg" plain>
        불러오지 못했어요.
      </InlineError>,
    );
    expect(screen.getByRole('alert').className).toBe('ui-inline-error is-plain');
  });

  it('action은 [다시 시도] 뒤에 그린다', () => {
    render(
      <InlineError onRetry={() => {}} action={<a href="/login">로그인</a>}>
        로그인이 필요합니다.
      </InlineError>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.lastElementChild?.textContent).toBe('로그인');
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
  });
});
