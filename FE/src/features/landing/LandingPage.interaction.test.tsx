// @vitest-environment happy-dom
// 랜딩 라우트 상호작용(설계 UX-353 6장): 주소·인증 상태별 팝업·리다이렉트, 모드별 돌아갈 경로, 오류 문구, 가입 동의 제출.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { UserMe } from '@/domain/account/auth';
import { SIGNUP_TERMS } from '@/domain/account/signupTerms';
import { useAuth } from '@/store/authStore';
import { LandingPage } from './LandingPage';

vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});

// 개발용 .env.local(VITE_AUTH_REQUIRED=false)이 테스트에 새지 않게 값을 직접 정한다
const flags = vi.hoisted(() => ({ required: true }));
vi.mock('@/config/auth', () => ({
  get AUTH_REQUIRED() {
    return flags.required;
  },
}));

const USER: UserMe = {
  id: 1,
  provider: 'GOOGLE',
  nickname: '드러머곰',
  profileImageUrl: null,
  role: 'USER',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  dataConsent: { agreed: true, version: SIGNUP_TERMS[2].version, updatedAt: '2026-11-02T00:00:00Z' },
  signupCompleted: true,
  consents: { terms: { version: SIGNUP_TERMS[0].version, agreedAt: '2026-01-01T00:00:00Z' }, privacy: { version: SIGNUP_TERMS[1].version, agreedAt: '2026-01-01T00:00:00Z' } },
};
const NEW_USER: UserMe = { ...USER, signupCompleted: false, dataConsent: { agreed: null, version: null, updatedAt: null }, consents: { terms: null, privacy: null } };

/** 현재 주소를 화면에 보여 줘 이동을 확인한다 */
function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function setup(entry: string | { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Where />
      <Routes>
        {/* 앱 화면 자리 — 이동 결과만 본다 */}
        {['/free', '/sheet', '/play', '/history'].map((p) => (
          <Route key={p} path={p} element={<div>앱 화면</div>} />
        ))}
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent;
const dialog = () => screen.queryByRole('dialog');

const startLogin = vi.fn();
const submitSignupConsent = vi.fn();

beforeEach(() => {
  flags.required = true;
  startLogin.mockReset();
  submitSignupConsent.mockReset().mockResolvedValue(undefined);
  useAuth.setState({ status: 'anonymous', user: null, lostReason: null, startLogin, submitSignupConsent });
});
afterEach(cleanup);

describe('비로그인 /', () => {
  it('랜딩만 보이고 팝업은 없다. 헤더 로그인 → 팝업, 제공자 클릭은 /free로 돌아가게 한다', async () => {
    const user = userEvent.setup();
    setup('/');
    expect(dialog()).toBeNull();
    await user.click(screen.getAllByRole('button', { name: /로그인/ })[0]);
    expect(where()).toBe('/login');
    expect(screen.getByRole('dialog', { name: '로그인' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Google로 계속하기' }));
    expect(startLogin).toHaveBeenCalledWith('google', '/free');
  });

  it.each([
    ['악보', '/sheet'],
    ['게임', '/play'],
    ['자유', '/free'],
  ])('%s 카드 → 모드 안내와 함께 %s로 돌아가게 한다', async (name, route) => {
    const user = userEvent.setup();
    setup('/');
    await user.click(screen.getAllByRole('button', { name: `${name} 모드로 시작` })[0]);
    expect(screen.getByText(`로그인하면 ${name} 모드로 바로 시작합니다.`)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Google로 계속하기' }));
    expect(startLogin).toHaveBeenCalledWith('google', route);
  });

  it('팝업이 열려 있으면 단축키 2는 무시한다', async () => {
    const user = userEvent.setup();
    setup('/');
    await user.keyboard('1');
    expect(where()).toBe('/login');
    await user.keyboard('2');
    expect(screen.getByText('로그인하면 자유 모드로 바로 시작합니다.')).toBeTruthy();
  });
});

describe('/login', () => {
  it('?error= 코드의 오류 문구를 보이고 Esc로 /로 닫는다', async () => {
    const user = userEvent.setup();
    setup('/login?error=session_expired');
    expect(screen.getByText('로그인이 만료되었습니다. 다시 로그인해 주세요.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(where()).toBe('/');
    expect(dialog()).toBeNull();
  });

  it('닫기(X) 버튼으로 /로 닫는다', async () => {
    const user = userEvent.setup();
    setup({ pathname: '/login', state: { from: '/sheet' } });
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(where()).toBe('/');
    expect(dialog()).toBeNull();
  });

  it('탈퇴 완료 문구는 오류 색이 아니다', () => {
    setup('/login?error=withdrawn');
    expect(screen.getByText(/탈퇴가 완료되었습니다/).className).toBe('notice');
  });

  it('state.from이 있으면 그 경로로 돌아가게 한다', async () => {
    const user = userEvent.setup();
    setup({ pathname: '/login', state: { from: '/history' } });
    await user.click(screen.getByRole('button', { name: 'Google로 계속하기' }));
    expect(startLogin).toHaveBeenCalledWith('google', '/history');
  });
});

describe('로그인 상태', () => {
  beforeEach(() => useAuth.setState({ status: 'authenticated', user: USER }));

  it.each(['/', '/login'])('%s는 /free로 간다', async (path) => {
    setup(path);
    await waitFor(() => expect(where()).toBe('/free'));
  });

  it('/login의 state.from이 있으면 그 경로로 간다', async () => {
    setup({ pathname: '/login', state: { from: '/sheet' } });
    await waitFor(() => expect(where()).toBe('/sheet'));
  });
});

describe('가입 동의가 필요한 회원', () => {
  beforeEach(() => useAuth.setState({ status: 'authenticated', user: NEW_USER }));

  it('/는 /signup으로 간다', async () => {
    setup('/');
    await waitFor(() => expect(where()).toBe('/signup'));
  });

  it('/signup은 팝업으로 뜨고 Esc로 닫히지 않으며, 필수 동의 후 제출하면 고른 모드로 간다', async () => {
    const user = userEvent.setup();
    setup({ pathname: '/signup', state: { from: '/sheet' } });
    expect(screen.getByRole('dialog', { name: '가입 동의' })).toBeTruthy();
    expect(screen.getByText('악보 모드로 시작하기 전에 약관에 동의해 주세요.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(dialog()).toBeTruthy();
    expect(where()).toBe('/signup');
    await user.click(screen.getByRole('checkbox', { name: '필수 항목에 모두 동의합니다' }));
    await user.click(screen.getByRole('button', { name: '동의하고 시작하기' }));
    await waitFor(() => expect(where()).toBe('/sheet'));
    expect(submitSignupConsent).toHaveBeenCalledTimes(1);
  });
});

describe('/signup 비로그인·확인 중', () => {
  it('비로그인이면 /login으로 간다', async () => {
    setup('/signup');
    await waitFor(() => expect(where()).toBe('/login'));
  });

  it('확인 중이면 대기 팝업을 보인다', () => {
    useAuth.setState({ status: 'restoring', user: null, restore: vi.fn().mockResolvedValue(undefined) });
    setup('/signup');
    expect(screen.getByText('로그인 확인 중…')).toBeTruthy();
  });
});

describe('로그인 확인 중', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'restoring', user: null, restore: vi.fn().mockResolvedValue(undefined) });
  });

  it.each(['/', '/login'])('%s는 랜딩·팝업 없이 확인 중 화면만 보인다', (path) => {
    setup(path);
    expect(screen.getByText('로그인 확인 중…')).toBeTruthy();
    expect(dialog()).toBeNull();
    expect(screen.queryAllByRole('button', { name: /로그인/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: '자유 모드로 시작' })).toHaveLength(0);
  });

  it('로그인으로 확인되면 랜딩 없이 /free로 간다', async () => {
    setup('/');
    expect(screen.queryAllByRole('button', { name: /로그인/ })).toHaveLength(0);
    act(() => useAuth.setState({ status: 'authenticated', user: USER }));
    await waitFor(() => expect(where()).toBe('/free'));
    expect(screen.queryAllByRole('button', { name: /로그인/ })).toHaveLength(0);
  });

  it('비로그인으로 확인되면 랜딩이 보인다', () => {
    setup('/');
    act(() => useAuth.setState({ status: 'anonymous', user: null }));
    expect(screen.getAllByRole('button', { name: /로그인/ }).length).toBeGreaterThan(0);
  });
});

describe('VITE_AUTH_REQUIRED=false 빌드', () => {
  beforeEach(() => {
    flags.required = false;
  });

  it('/는 /free로 간다', async () => {
    setup('/');
    await waitFor(() => expect(where()).toBe('/free'));
  });

  it('/welcome은 랜딩이고 시작·모드는 팝업 없이 바로 이동한다', async () => {
    const user = userEvent.setup();
    setup('/welcome');
    expect(dialog()).toBeNull();
    await user.click(screen.getAllByRole('button', { name: '게임 모드로 시작' })[0]);
    expect(where()).toBe('/play');
  });
});
