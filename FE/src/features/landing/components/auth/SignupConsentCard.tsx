// Figma Auth / SignupConsentCard 440:19890 — 가입 동의 카드. 동의 상태(어느 항목을 켰는지)는 여기서 들고, 제출 뒤 동작은 onSubmit으로 넘긴다.
// 「필수 항목에 모두 동의합니다」는 별도 상태가 아니라 필수 항목이 전부 켜졌는지의 파생값이고, 선택 항목은 켜지도 끄지도 않는다(설계 COACH-003 D7, COACH-004 D2).
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Card } from '@/components/ui/layout/Card';
import { Checkbox } from '@/components/ui/form/Checkbox';
import {
  SIGNUP_INTRO,
  SIGNUP_TERMS,
  recommendationConsentEnabled,
  allAgreed,
  allRequiredAgreed,
  currentConsentVersions,
  toggleAll,
  toggleOne,
  type ConsentVersions,
  type SignupTerm,
  type SignupTermId,
} from '@/domain/account/signupTerms';
import { TermsItem } from './TermsItem';
import './auth.css';

interface Props {
  /** 기본은 SIGNUP_TERMS. 테스트·시안 확인용으로 바꿀 수 있다 */
  terms?: readonly SignupTerm[];
  /** 필수 항목을 모두 켜고 [동의하고 시작하기]를 눌렀을 때. 현재 약관 판과 선택 항목 체크 여부를 BE 저장 본문 모양으로 준다 */
  onSubmit: (versions: ConsentVersions) => void;
  /** 서버 저장 중이면 true. 버튼을 잠근다 */
  submitting?: boolean;
  /** 제출 실패 문구. 버튼 위에 보인다 */
  error?: string | null;
  notice?: ReactNode;
  /** 처음부터 켜 둘 항목. 재동의 진입(`/signup`에 기존 회원이 옴)에서 이전에 동의한 선택 항목을 보존할 때 쓴다(설계 4-4). 기본은 전부 꺼짐 */
  initialAgreed?: readonly SignupTermId[];
}

export function SignupConsentCard({ terms = recommendationConsentEnabled() ? SIGNUP_TERMS : SIGNUP_TERMS.filter((t) => t.id !== 'recommendation'), onSubmit, submitting = false, error = null, notice, initialAgreed = [] }: Props) {
  const [agreed, setAgreed] = useState<ReadonlySet<SignupTermId>>(() => new Set(initialAgreed));
  const canSubmit = allRequiredAgreed(agreed, terms) && !submitting;

  return (
    <Card padding="lg" className="signup-card">
      <div className="signup-card-head">
        <h1 className="t-title-20">가입 동의</h1>
        <p className="t-body-14 signup-card-desc">{SIGNUP_INTRO}</p>
      </div>
      <Checkbox
        checked={allAgreed(agreed, terms)}
        onChange={() => setAgreed((prev) => toggleAll(prev, terms))}
        label="필수 항목에 모두 동의합니다"
        labelStyle="body-16"
        className="signup-card-all"
      />
      <hr className="signup-card-divider" />
      {terms.map((term) => (
        <TermsItem key={term.id} term={term} checked={agreed.has(term.id)} onChange={() => setAgreed((prev) => toggleOne(prev, term.id))} />
      ))}
      {notice}
      {error && (
        <p className="signup-card-error t-body-14" role="alert">
          {error}
        </p>
      )}
      <Button fullWidth disabled={!canSubmit} onClick={() => onSubmit(currentConsentVersions(terms, agreed))}>
        동의하고 시작하기
      </Button>
    </Card>
  );
}
