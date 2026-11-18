// @vitest-environment happy-dom
// 기존 사용자 학습 동의 1회 안내(설계 COACH-004-recommendation-consent D6·4-2): AppShell이 로그인 복원 뒤 읽고,
// 동의/괜찮아요/Esc/배경이 각각 PUT true/false를 보내 닫히며 다시 뜨지 않고, PUT 실패·/signup·immersive·비로그인에서는 띄우지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { ApiError } from '@/api/http';
import { getRecommendationConsent, putRecommendationConsent } from '@/api/account/users';
import type { UserMe } from '@/domain/account/auth';
import { recommendationVersion } from '@/domain/account/signupTerms';
import { useAuth } from '@/store/authStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import { useShellStore } from '@/store/shellStore';

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

vi.mock('@/api/account/users', () => ({
  getRecommendationConsent: vi.fn(),
  putRecommendationConsent: vi.fn(),
  fetchMe: vi.fn(),
  postSignupConsent: vi.fn(),
  withdrawMe: vi.fn(),
}));
// 이 테스트가 보는 것은 안내 모달뿐이다 — 셸의 무거운 자식은 비운다
vi.mock('@/components/shell/nav/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/shell/nav/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/shell/dock/GlassDock', () => ({ GlassDock: () => null }));
vi.mock('@/components/shell/account/ProfileMenu', () => ({ ProfileMenu: () => null }));
vi.mock('@/components/shell/dock/StickStatusIndicator', () => ({ StickStatusIndicator: () => null }));
vi.mock('@/components/shell/useMediaQuery', () => ({ useSidebarCollapsed: () => false }));
vi.mock('@/components/recording/SaveRecordingDialog', () => ({ SaveRecordingDialog: () => null }));
vi.mock('@/components/recording/RecordingToast', () => ({ RecordingToast: () => null }));
vi.mock('./DebugOverlay', () => ({ DebugOverlay: () => null }));

const V = recommendationVersion();
const NONE = { agreed: false, version: null, updatedAt: null };
const USER: UserMe = {
  id: 1,
  provider: 'GOOGLE',
  nickname: '드러머곰',
  profileImageUrl: null,
  role: 'USER',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  dataConsent: { agreed: true, version: '2026-11-02', updatedAt: '2026-11-02T00:00:00Z' },
  signupCompleted: true,
  consents: { terms: null, privacy: null },
};

const dialog = () => screen.queryByRole('dialog');
const title = '맞춤 곡 추천 학습에 연주 기록을 쓸까요?';

function setup(path = '/free') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell authRequired />}>
          <Route path="*" element={<div>화면</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_RECOMMENDATION_CONSENT_ENABLED', 'true');
  useRecommendationConsent.getState().resetForTest();
  useShellStore.setState({ immersive: false });
  useAuth.setState({ status: 'authenticated', user: USER, lostReason: null });
  vi.mocked(getRecommendationConsent).mockReset().mockResolvedValue(NONE);
  vi.mocked(putRecommendationConsent).mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('기존 사용자 학습 동의 안내', () => {
  it('한 번도 답하지 않았으면 본문 요약과 두 버튼이 뜬다', async () => {
    setup();
    expect(await screen.findByRole('dialog', { name: title })).toBeTruthy();
    expect(screen.getByText(/곡 추천 모델을 학습·평가하고 개선해요/)).toBeTruthy();
    expect(screen.getByText(/설정에서 언제든 철회할 수 있어요/)).toBeTruthy();
    expect(screen.getByText(/맞춤 모델 추천 대신 기본 추천을 제공해요/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '동의하고 사용' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '괜찮아요' }));
    expect(getRecommendationConsent).toHaveBeenCalledTimes(1);
  });

  it('[동의하고 사용] → PUT true, 닫힘, 다시 뜨지 않는다', async () => {
    vi.mocked(putRecommendationConsent).mockResolvedValue({ agreed: true, version: V, updatedAt: '2026-11-05T01:00:00Z' });
    setup();
    await userEvent.setup().click(await screen.findByRole('button', { name: '동의하고 사용' }));
    expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: true, version: V });
    await waitFor(() => expect(dialog()).toBeNull());
    await act(async () => useAuth.setState({ user: { ...USER } }));
    expect(dialog()).toBeNull();
    expect(putRecommendationConsent).toHaveBeenCalledTimes(1);
  });

  it('[괜찮아요] → PUT false, 닫힘', async () => {
    vi.mocked(putRecommendationConsent).mockResolvedValue({ agreed: false, version: V, updatedAt: '2026-11-05T01:00:00Z' });
    setup();
    await userEvent.setup().click(await screen.findByRole('button', { name: '괜찮아요' }));
    expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: false, version: V });
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('Esc → PUT false, 닫힘', async () => {
    vi.mocked(putRecommendationConsent).mockResolvedValue({ agreed: false, version: V, updatedAt: '2026-11-05T01:00:00Z' });
    setup();
    await screen.findByRole('dialog');
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: false, version: V }));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('배경 클릭 → PUT false, 닫힘', async () => {
    vi.mocked(putRecommendationConsent).mockResolvedValue({ agreed: false, version: V, updatedAt: '2026-11-05T01:00:00Z' });
    const { container } = setup();
    await screen.findByRole('dialog');
    fireEvent.mouseDown(container.querySelector('.dialog-backdrop') as Element);
    await waitFor(() => expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: false, version: V }));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('PUT이 실패하면 닫고 이번 세션에는 다시 띄우지 않는다', async () => {
    vi.mocked(putRecommendationConsent).mockRejectedValue(new ApiError(0, 'NETWORK', 'x'));
    setup();
    await userEvent.setup().click(await screen.findByRole('button', { name: '동의하고 사용' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(useRecommendationConsent.getState().dismissed).toBe(true);
    await act(async () => useAuth.setState({ user: { ...USER } }));
    expect(dialog()).toBeNull();
    expect(putRecommendationConsent).toHaveBeenCalledTimes(1);
  });
});

describe('안내를 띄우지 않는 경우', () => {
  it('이미 답한 사용자(동의·거부 모두)', async () => {
    vi.mocked(getRecommendationConsent).mockResolvedValue({ agreed: false, version: V, updatedAt: '2026-11-05T01:00:00Z' });
    setup();
    await waitFor(() => expect(useRecommendationConsent.getState().status).toBe('ready'));
    expect(dialog()).toBeNull();
  });

  it('읽기에 실패하면 띄우지 않는다', async () => {
    vi.mocked(getRecommendationConsent).mockRejectedValue(new Error('x'));
    setup();
    await waitFor(() => expect(useRecommendationConsent.getState().status).toBe('error'));
    expect(dialog()).toBeNull();
  });

  it('/signup 경로', async () => {
    setup('/signup');
    await waitFor(() => expect(useRecommendationConsent.getState().status).toBe('ready'));
    expect(dialog()).toBeNull();
  });

  it('연주 중(immersive)에는 숨겼다가 벗어나면 띄운다', async () => {
    useShellStore.setState({ immersive: true });
    setup('/play');
    await waitFor(() => expect(useRecommendationConsent.getState().status).toBe('ready'));
    expect(dialog()).toBeNull();
    await act(async () => useShellStore.setState({ immersive: false }));
    expect(await screen.findByRole('dialog', { name: title })).toBeTruthy();
  });

  it('비로그인에서는 읽지도 띄우지도 않는다', async () => {
    useAuth.setState({ status: 'anonymous', user: null });
    setup();
    await act(async () => {});
    expect(getRecommendationConsent).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('가입 전 회원(signupCompleted=false)은 읽지 않는다', async () => {
    useAuth.setState({ user: { ...USER, signupCompleted: false } });
    setup();
    await act(async () => {});
    expect(getRecommendationConsent).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });
});
