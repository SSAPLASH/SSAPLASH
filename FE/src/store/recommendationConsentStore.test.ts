import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import { getRecommendationConsent, putRecommendationConsent } from '@/api/account/users';
import { recommendationVersion } from '@/domain/account/signupTerms';
import { useRecommendationConsent } from './recommendationConsentStore';

vi.mock('@/api/account/users', () => ({ getRecommendationConsent: vi.fn(), putRecommendationConsent: vi.fn() }));

const V = recommendationVersion();
const NONE = { agreed: false, version: null, updatedAt: null };
const state = () => useRecommendationConsent.getState();

beforeEach(() => {
  state().resetForTest();
  vi.mocked(getRecommendationConsent).mockReset();
  vi.mocked(putRecommendationConsent).mockReset();
});

describe('load', () => {
  it('성공하면 ready와 consent', async () => {
    vi.mocked(getRecommendationConsent).mockResolvedValue(NONE);
    await state().load();
    expect(state().status).toBe('ready');
    expect(state().consent).toEqual(NONE);
  });

  it('세션당 1회: ready·loading 뒤 다시 불러도 GET은 한 번', async () => {
    vi.mocked(getRecommendationConsent).mockResolvedValue(NONE);
    await Promise.all([state().load(), state().load()]);
    await state().load();
    expect(getRecommendationConsent).toHaveBeenCalledTimes(1);
  });

  it('실패하면 error이며 다시 요청할 수 있다', async () => {
    vi.mocked(getRecommendationConsent).mockRejectedValue(new Error('x'));
    await expect(state().load()).resolves.toBeUndefined();
    expect(state().status).toBe('error');
    expect(state().consent).toBeNull();
    await state().load();
    expect(getRecommendationConsent).toHaveBeenCalledTimes(2);
  });
});

describe('set', () => {
  it('현재 판으로 PUT하고 응답으로 consent를 바꾼다', async () => {
    const res = { agreed: true, version: V, updatedAt: '2026-11-05T01:00:00Z' };
    vi.mocked(putRecommendationConsent).mockResolvedValue(res);
    await state().set(true);
    expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: true, version: V });
    expect(state().consent).toEqual(res);
    expect(state().status).toBe('ready');
    expect(state().saving).toBe(false);
  });

  it('false도 판을 싣는다', async () => {
    vi.mocked(putRecommendationConsent).mockResolvedValue({ agreed: false, version: V, updatedAt: 't' });
    await state().set(false);
    expect(putRecommendationConsent).toHaveBeenCalledWith({ agreed: false, version: V });
  });

  it('422도 그대로 던지고 consent는 유지하며 saving을 푼다', async () => {
    vi.mocked(getRecommendationConsent).mockResolvedValue(NONE);
    await state().load();
    const err = new ApiError(422, 'SIGNUP_CONSENT_VERSION_INVALID', '판 불일치');
    vi.mocked(putRecommendationConsent).mockRejectedValue(err);
    await expect(state().set(true)).rejects.toBe(err);
    expect(state().consent).toEqual(NONE);
    expect(state().saving).toBe(false);
  });

  it('네트워크 오류도 던진다', async () => {
    vi.mocked(putRecommendationConsent).mockRejectedValue(new ApiError(0, 'NETWORK', 'x'));
    await expect(state().set(true)).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('저장 중 두 번째 set은 무시한다', async () => {
    let resolve!: (v: { agreed: boolean; version: string; updatedAt: string }) => void;
    vi.mocked(putRecommendationConsent).mockReturnValue(new Promise((r) => (resolve = r)));
    const first = state().set(true);
    expect(state().saving).toBe(true);
    await state().set(false);
    resolve({ agreed: true, version: V, updatedAt: 't' });
    await first;
    expect(putRecommendationConsent).toHaveBeenCalledTimes(1);
  });
});

describe('dismissForSession · reset', () => {
  it('dismissForSession은 dismissed만 켠다', () => {
    state().dismissForSession();
    expect(state().dismissed).toBe(true);
  });

  it('reset은 모두 처음으로 되돌려 다시 load할 수 있다', async () => {
    vi.mocked(getRecommendationConsent).mockResolvedValue(NONE);
    await state().load();
    state().dismissForSession();
    state().reset();
    expect(state()).toMatchObject({ status: 'idle', consent: null, dismissed: false, saving: false });
    await state().load();
    expect(getRecommendationConsent).toHaveBeenCalledTimes(2);
  });
});
