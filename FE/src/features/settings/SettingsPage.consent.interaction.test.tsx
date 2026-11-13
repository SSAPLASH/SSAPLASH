// @vitest-environment happy-dom
// 설정 "데이터 활용" 카드 상호작용: 진입 시 load, 토글 → PUT, 끄면 토스트, 422·실패 문구 (설계 COACH-004 D7·D8, 4-3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@/api/http';
import { getRecommendationConsent, putRecommendationConsent, withdrawMe } from '@/api/account/users';
import type { UserMe } from '@/domain/account/auth';
import { recommendationVersion } from '@/domain/account/signupTerms';
import { useAuth } from '@/store/authStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import { usePresets } from '@/store/presetStore';
import { SettingsPage } from './SettingsPage';

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

const V = recommendationVersion();
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

const toggle = () => screen.getByRole('switch', { name: '맞춤 곡 추천 학습 활용' }) as HTMLButtonElement;

function setup(initial: { agreed: boolean; version: string | null; updatedAt: string | null }) {
  vi.mocked(getRecommendationConsent).mockResolvedValue(initial);
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_RECOMMENDATION_CONSENT_ENABLED', 'true');
  useRecommendationConsent.getState().resetForTest();
  useAuth.setState({ status: 'authenticated', user: USER });
  vi.mocked(getRecommendationConsent).mockReset();
  vi.mocked(putRecommendationConsent).mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('설정 데이터 활용 토글', () => {
  it('진입하면 한 번 읽고 상태를 보인다', async () => {
    setup({ agreed: true, version: V, updatedAt: '2026-11-05T12:00:00Z' });
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    expect(getRecommendationConsent).toHaveBeenCalledTimes(1);
    expect(toggle().disabled).toBe(false);
  });

  it('끄면 현재 판으로 PUT false를 보내고 "동의를 철회했어요" 토스트가 뜬다', async () => {
    setup({ agreed: true, version: V, updatedAt: '2026-11-05T12:00:00Z' });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    vi.mocked(putRecommendationConsent).mockResolvedValue({ agreed: false, version: V, updatedAt: '2026-11-05T13:00:00Z' });
    await userEvent.setup().click(toggle());
    expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: false, version: V });
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByText('동의를 철회했어요')).toBeTruthy();
  });

  it('켜면 PUT true를 보내고 켜진 상태가 된다', async () => {
    setup({ agreed: false, version: null, updatedAt: null });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    vi.mocked(putRecommendationConsent).mockResolvedValue({ agreed: true, version: V, updatedAt: '2026-11-05T13:00:00Z' });
    await userEvent.setup().click(toggle());
    await userEvent.setup().click(screen.getByRole('button', { name: '동의' }));
    expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: true, version: V });
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByText('이후 학습부터 제외돼요')).toBeNull();
  });

  it('422면 새로고침 안내, 상태는 그대로', async () => {
    setup({ agreed: false, version: V, updatedAt: '2026-11-05T12:00:00Z' });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    vi.mocked(putRecommendationConsent).mockRejectedValue(new ApiError(422, 'SIGNUP_CONSENT_VERSION_INVALID', '판'));
    await userEvent.setup().click(toggle());
    await userEvent.setup().click(screen.getByRole('button', { name: '동의' }));
    expect(await screen.findByText('약관이 갱신되었어요. 새로고침한 뒤 다시 시도해 주세요.')).toBeTruthy();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('그 밖의 실패는 다시 시도 안내', async () => {
    setup({ agreed: false, version: V, updatedAt: '2026-11-05T12:00:00Z' });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    vi.mocked(putRecommendationConsent).mockRejectedValue(new ApiError(0, 'NETWORK', 'x'));
    await userEvent.setup().click(toggle());
    await userEvent.setup().click(screen.getByRole('button', { name: '동의' }));
    expect(await screen.findByText('저장하지 못했어요. 다시 시도해 주세요.')).toBeTruthy();
  });

  it('수집이 꺼져도 기존 구판 동의를 철회하며 실패하면 동의를 유지한다', async () => {
    vi.stubEnv('VITE_RECOMMENDATION_CONSENT_ENABLED', 'false');
    setup({ agreed: true, version: 'old', updatedAt: null });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(screen.getByText(/이전 판에 동의함/)).toBeTruthy();
    vi.mocked(putRecommendationConsent).mockRejectedValue(new ApiError(422, 'SIGNUP_CONSENT_VERSION_INVALID', '판'));
    await userEvent.setup().click(toggle());
    expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: false, version: V });
    expect(await screen.findByText('약관이 갱신되었어요. 새로고침한 뒤 다시 시도해 주세요.')).toBeTruthy();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('수집이 꺼지고 미동의이면 신규 토글을 보이지 않는다', async () => {
    vi.stubEnv('VITE_RECOMMENDATION_CONSENT_ENABLED', 'false');
    setup({ agreed: false, version: null, updatedAt: null });
    await screen.findByText('미동의');
    expect(screen.queryByRole('switch', { name: '맞춤 곡 추천 학습 활용' })).toBeNull();
  });

  it('읽기에 실패하면 잠기고 안내가 뜬다', async () => {
    vi.mocked(getRecommendationConsent).mockRejectedValue(new Error('x'));
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('동의 상태를 불러오지 못했어요')).toBeTruthy();
    expect(toggle().disabled).toBe(true);
    vi.mocked(getRecommendationConsent).mockResolvedValue({ agreed: false, version: null, updatedAt: null });
    await userEvent.setup().click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('미동의')).toBeTruthy();
  });
});


describe('설정 회원 탈퇴', () => {
  it('텍스트 버튼은 되돌릴 수 없음 확인 창만 열고 취소할 수 있다', async () => {
    setup({ agreed: false, version: null, updatedAt: null });
    await userEvent.setup().click(screen.getByRole('button', { name: '회원 탈퇴' }));
    expect(screen.getByText('탈퇴하면 되돌릴 수 없습니다.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '취소' }));
    expect(withdrawMe).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText('탈퇴하면 되돌릴 수 없습니다.')).toBeNull();
    expect(withdrawMe).not.toHaveBeenCalled();
  });
});


describe('설정 진입', () => {
  it('기기 카드 제거 후 프리셋 목록을 다시 불러오지 않는다', () => {
    const refresh = vi.spyOn(usePresets.getState(), 'refresh');
    setup({ agreed: false, version: null, updatedAt: null });
    expect(refresh).not.toHaveBeenCalled();
    refresh.mockRestore();
  });
});
