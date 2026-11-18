// 맞춤 곡 추천 학습 활용 동의 1회 안내 (설계 COACH-004-recommendation-consent D6·4-2). 한 번도 답하지 않은 기존 사용자에게 AppShell이 띄운다.
// 상태를 갖지 않는다 — 열림·진행은 호출자(AppShell)가 정하고 서버 저장은 store가 한다. 본문은 가입 카드 항목과 같은 문구를 요약해 보인다.
// 기본은 미동의(D9): 초기 초점은 [괜찮아요]에 두고, Esc·배경 클릭도 미동의 응답이다. 저장 중에는 닫지 않는다.
import { useRef } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { SIGNUP_TERMS } from '@/domain/account/signupTerms';

interface Props {
  /** 저장(PUT) 진행 중. 버튼·Esc·배경을 잠근다 */
  busy: boolean;
  /** [동의하고 사용] */
  onAgree: () => void;
  /** [괜찮아요]·Esc·배경 클릭 */
  onDecline: () => void;
}

/** 가입 카드 항목 본문의 줄. 앞 번호("1. ")는 목록 표시와 겹치므로 뗀다 */
const LINES = (SIGNUP_TERMS.find((t) => t.id === 'recommendation')?.body ?? '')
  .split('\n')
  .map((line) => line.replace(/^\d+\.\s*/, ''))
  .filter(Boolean);

export function RecommendationConsentDialog({ busy, onAgree, onDecline }: Props) {
  const declineRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog labelledBy="recommend-consent-title" initialFocusRef={declineRef} closeOnBackdrop={!busy} closeOnEscape={!busy} onClose={onDecline}>
      <h2 id="recommend-consent-title">맞춤 곡 추천 학습에 연주 기록을 쓸까요?</h2>
      <ul>
        {LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>닫거나 괜찮아요를 선택하면 동의하지 않은 것으로 기록돼요.</p>
      <div className="dialog-actions">
        <Button variant="secondary" ref={declineRef} onClick={onDecline} disabled={busy}>
          괜찮아요
        </Button>
        <Button onClick={onAgree} disabled={busy}>
          동의하고 사용
        </Button>
      </div>
    </Dialog>
  );
}
