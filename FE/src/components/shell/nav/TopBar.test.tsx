// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopBar } from './TopBar';

afterEach(cleanup);

describe('TopBar 로고 심벌', () => {
  it('제목 왼쪽에 로고 S 이미지를 장식으로 그린다', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/play']}>
        <TopBar />
      </MemoryRouter>,
    );
    const logo = container.querySelector('.topbar-heading img.topbar-logo');
    expect(logo?.getAttribute('src')).toBe('/images/ssaplash-symbol.webp');
    expect(logo?.getAttribute('alt')).toBe('');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
    // 로고가 제목보다 앞에 온다
    expect(logo?.nextElementSibling).toBe(screen.getByRole('heading', { level: 1 }));
  });
});
