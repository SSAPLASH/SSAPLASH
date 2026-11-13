// @vitest-environment happy-dom
// 프로필 메뉴(QA 352): 메뉴에는 로그아웃만 두고 설정은 없다. 제공자 사진을 불러오지 못하면 이니셜로 바꾼다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProfileMenu } from '@/components/shell/account/ProfileMenu';
import type { UserMe } from '@/domain/account/auth';
import { useAuth } from '@/store/authStore';

// Node 실험적 localStorage가 happy-dom 것을 가려 persist 저장이 실패한다 — import 전에 메모리 저장소로 대체한다
vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});

const USER = {
  id: 1,
  provider: 'GOOGLE',
  nickname: '원빈',
  profileImageUrl: 'https://lh3.googleusercontent.com/a/photo',
  role: 'USER',
} as UserMe;

function renderMenu(user: UserMe = USER) {
  useAuth.setState({ status: 'authenticated', user });
  return render(
    <MemoryRouter>
      <ProfileMenu />
    </MemoryRouter>,
  );
}

describe('ProfileMenu', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'authenticated', user: USER });
  });
  afterEach(() => {
    cleanup();
  });

  it('메뉴에는 로그아웃만 있고 설정 항목은 없다', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '프로필 메뉴' }));
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['로그아웃']);
  });

  it('사진을 불러오면 img를, 불러오지 못하면 이니셜을 보인다', () => {
    const { container } = renderMenu();
    const img = container.querySelector('img.profile-avatar');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector('img.profile-avatar')).toBeNull();
    expect(container.querySelector('.profile-initial')?.textContent).toBe('원');
  });

  it('사진 URL이 없으면 이니셜을 보인다', () => {
    const { container } = renderMenu({ ...USER, profileImageUrl: null });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.profile-initial')?.textContent).toBe('원');
  });
});
