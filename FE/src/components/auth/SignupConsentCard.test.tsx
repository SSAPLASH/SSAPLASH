import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SIGNUP_INTRO, SIGNUP_TERMS } from '@/domain/signupTerms';
import { SignupConsentCard } from './SignupConsentCard';
import { TermsItem } from './TermsItem';

describe('SignupConsentCard', () => {
  const html = renderToStaticMarkup(<SignupConsentCard onSubmit={() => {}} />);

  it('제목·설명·모두 동의·항목 3개·버튼이 Figma 순서로 보인다', () => {
    const order = ['가입 동의', SIGNUP_INTRO, '모두 동의합니다', 'signup-card-divider', ...SIGNUP_TERMS.map((t) => t.title), '동의하고 시작하기'];
    let last = -1;
    for (const s of order) {
      const i = html.indexOf(s);
      expect(i, s).toBeGreaterThan(last);
      last = i;
    }
    expect(html).toContain('ui-card-lg');
  });

  it('처음에는 아무것도 체크되지 않고 버튼이 비활성이다', () => {
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>동의하고 시작하기/);
    expect(html).toContain('ui-btn-full');
  });

  it('submitting이면 버튼을 잠근다', () => {
    const h = renderToStaticMarkup(<SignupConsentCard onSubmit={() => {}} submitting />);
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
