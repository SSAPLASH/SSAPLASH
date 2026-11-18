import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SIGNUP_INTRO, SIGNUP_TERMS } from '@/domain/account/signupTerms';
import { SignupConsentCard } from './SignupConsentCard';
import { TermsItem } from './TermsItem';

describe('SignupConsentCard', () => {
  const html = renderToStaticMarkup(<SignupConsentCard terms={SIGNUP_TERMS} onSubmit={() => {}} />);

  it('제목·설명·필수 모두 동의·항목 4개·버튼이 Figma 순서로 보인다', () => {
    const order = ['가입 동의', SIGNUP_INTRO, '필수 항목에 모두 동의합니다', 'signup-card-divider', ...SIGNUP_TERMS.map((t) => t.title), '동의하고 시작하기'];
    let last = -1;
    for (const s of order) {
      const i = html.indexOf(s);
      expect(i, s).toBeGreaterThan(last);
      last = i;
    }
    expect(html).toContain('ui-card-lg');
  });

  it('네 번째 항목은 [선택]이고 필수 표시는 셋뿐이다', () => {
    expect(html.match(/\[필수\]/g)?.length).toBe(3);
    expect(html.match(/\[선택\]/g)?.length).toBe(1);
    expect(html.indexOf('[선택]')).toBeGreaterThan(html.indexOf(SIGNUP_TERMS[2].title));
  });

  it('처음에는 아무것도 체크되지 않고 버튼이 비활성이다', () => {
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>동의하고 시작하기/);
    expect(html).toContain('ui-btn-full');
  });

  it('error가 있으면 버튼 앞에 role=alert 문구가 보인다', () => {
    const h = renderToStaticMarkup(<SignupConsentCard terms={SIGNUP_TERMS} onSubmit={() => {}} error="동의를 저장하지 못했습니다." />);
    expect(h).toContain('<p class="signup-card-error t-body-14" role="alert">동의를 저장하지 못했습니다.</p>');
    expect(h.indexOf('signup-card-error')).toBeLessThan(h.indexOf('동의하고 시작하기'));
  });

  it('error가 없으면 오류 문구가 없다', () => {
    expect(html).not.toContain('signup-card-error');
  });

  it('submitting이면 버튼을 잠근다', () => {
    const h = renderToStaticMarkup(<SignupConsentCard terms={SIGNUP_TERMS} onSubmit={() => {}} submitting />);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>동의하고 시작하기/);
  });
});

describe('SignupConsentCard initialAgreed', () => {
  it('넘긴 항목만 처음부터 체크돼 있다', () => {
    const h = renderToStaticMarkup(<SignupConsentCard terms={SIGNUP_TERMS} onSubmit={() => {}} initialAgreed={['recommendation']} />);
    expect(h.match(/checked=""/g)?.length).toBe(1);
    // 필수 항목은 꺼져 있어 버튼은 여전히 잠겨 있다
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>동의하고 시작하기/);
  });
});

describe('TermsItem', () => {
  const term = SIGNUP_TERMS[2];

  it('[필수]·제목·96 높이 스크롤 상자(초점 가능, 이름 있음)와 본문 단락을 그린다', () => {
    const html = renderToStaticMarkup(<TermsItem term={term} checked={false} onChange={() => {}} />);
    expect(html).toContain('[필수]');
    expect(html).toContain(term.title);
    expect(html).toMatch(/<div class="terms-item-scroll t-caption-12" role="region" aria-label="연주 기록 활용 동의 전문" tabindex="0">/);
    expect(html.match(/<p>/g)?.length).toBe(term.body.split('\n').length);
    expect(html).not.toContain('checked=""');
  });

  it('선택 항목은 [선택], checked면 input checked', () => {
    const html = renderToStaticMarkup(<TermsItem term={{ ...term, required: false }} checked onChange={() => {}} />);
    expect(html).toContain('[선택]');
    expect(html).not.toContain('[필수]');
    expect(html).toContain('checked=""');
  });
});
