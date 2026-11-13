// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  afterEach(cleanup);

  it('role=alert, 기본 제목 단계는 h3, onRetry가 없으면 버튼이 없다', () => {
    render(<ErrorState title="불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요" />);
    expect(screen.getByRole('alert').className).toBe('ui-empty ui-error');
    expect(screen.getByRole('heading', { level: 3, name: '불러오지 못했어요' })).toBeTruthy();
    expect(screen.getByText('잠시 뒤 다시 시도해 주세요')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('onRetry가 있으면 [다시 시도]를 그리고 누르면 부른다', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="오류" onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: '다시 시도' });
    expect(button.className).toContain('ui-btn-secondary');
    await userEvent.setup().click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retryLabel·headingLevel·className', () => {
    render(<ErrorState title="새 버전이 있어요" headingLevel={2} onRetry={() => {}} retryLabel="새로고침" className="route-error" />);
    expect(screen.getByRole('heading', { level: 2, name: '새 버전이 있어요' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeTruthy();
    expect(screen.getByRole('alert').className).toBe('ui-empty ui-error route-error');
  });

  it('size lg면 큰 모양 클래스가 붙고 버튼도 기본 크기가 된다', () => {
    render(<ErrorState size="lg" title="오류" onRetry={() => {}} />);
    expect(screen.getByRole('alert').className).toBe('ui-empty ui-error ui-error-lg');
    expect(screen.getByRole('button', { name: '다시 시도' }).className).toContain('ui-btn-md');
  });

  it('action을 넣으면 onRetry 버튼 대신 그린다', () => {
    render(<ErrorState title="오류" onRetry={() => {}} action={<button>라이브러리로</button>} />);
    expect(screen.getByRole('button', { name: '라이브러리로' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
  });
});
