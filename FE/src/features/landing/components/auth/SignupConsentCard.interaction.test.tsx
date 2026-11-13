// @vitest-environment happy-dom
// 가입 동의 카드 상호작용: 선택 항목 미체크·체크 제출 본문, 「필수 항목에 모두 동의」가 선택 항목을 건드리지 않음, initialAgreed (설계 COACH-004 D2·D3·4-4).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SIGNUP_TERMS } from '@/domain/account/signupTerms';
import { SignupConsentCard } from './SignupConsentCard';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

const allRequired = () => screen.getByRole('checkbox', { name: '필수 항목에 모두 동의합니다' });
const recommendation = () => screen.getByRole('checkbox', { name: /곡 추천 개선을 위한 연주 기록 이용 동의/ });
const submit = () => screen.getByRole('button', { name: '동의하고 시작하기' });

describe('신규 동의 수집 비활성', () => {
  it('가입에 항목을 숨기고 기존 응답을 덮어쓰지 않도록 본문에서 생략한다', async () => {
    vi.stubEnv('VITE_RECOMMENDATION_CONSENT_ENABLED', 'false');
    const onSubmit = vi.fn();
    render(<SignupConsentCard onSubmit={onSubmit} />);
    expect(screen.queryByRole('checkbox', { name: /곡 추천 개선을 위한 연주 기록 이용 동의/ })).toBeNull();
    await userEvent.setup().click(allRequired());
    await userEvent.setup().click(submit());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('recommendationConsent');
  });
});

describe('SignupConsentCard 선택 항목', () => {
  it('필수 모두 동의만으로 활성이고, 선택 항목은 꺼져 있으며 제출 본문에 agreed false가 실린다', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<SignupConsentCard terms={SIGNUP_TERMS} onSubmit={onSubmit} />);
    expect((submit() as HTMLButtonElement).disabled).toBe(true);

    await user.click(allRequired());
    expect((allRequired() as HTMLInputElement).checked).toBe(true);
    expect((recommendation() as HTMLInputElement).checked).toBe(false);
    expect((submit() as HTMLButtonElement).disabled).toBe(false);

    await user.click(submit());
    expect(onSubmit).toHaveBeenCalledWith({
      termsVersion: SIGNUP_TERMS[0].version,
      privacyVersion: SIGNUP_TERMS[1].version,
      dataConsent: { agreed: true, version: SIGNUP_TERMS[2].version },
      recommendationConsent: { agreed: false, version: SIGNUP_TERMS[3].version },
    });
  });

  it('선택 항목을 체크하고 제출하면 agreed true', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<SignupConsentCard terms={SIGNUP_TERMS} onSubmit={onSubmit} />);
    await user.click(allRequired());
    await user.click(recommendation());
    await user.click(submit());
    expect(onSubmit.mock.calls[0][0].recommendationConsent).toEqual({ agreed: true, version: SIGNUP_TERMS[3].version });
  });

  it('선택 항목만 체크해서는 제출할 수 없고, 필수 모두 동의를 끄면 선택 항목은 그대로 둔다', async () => {
    const user = userEvent.setup();
    render(<SignupConsentCard terms={SIGNUP_TERMS} onSubmit={() => {}} />);
    await user.click(recommendation());
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    expect((allRequired() as HTMLInputElement).checked).toBe(false);

    await user.click(allRequired());
    await user.click(allRequired());
    expect((allRequired() as HTMLInputElement).checked).toBe(false);
    expect((recommendation() as HTMLInputElement).checked).toBe(true);
  });

  it('initialAgreed로 선택 항목을 미리 켠 채 시작하고 그대로 제출하면 agreed true', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<SignupConsentCard terms={SIGNUP_TERMS} onSubmit={onSubmit} initialAgreed={['recommendation']} />);
    expect((recommendation() as HTMLInputElement).checked).toBe(true);
    await user.click(allRequired());
    await user.click(submit());
    expect(onSubmit.mock.calls[0][0].recommendationConsent.agreed).toBe(true);
  });
});
