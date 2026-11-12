// 연주 기록 활용 동의 읽기 (설계 COACH-003-signup-consent D18).
// 플레이 시작 시점에 서버 값(authStore user.dataConsent)으로 동의 여부를 정한다. FE가 동의를 바꾸는 API는 없다(철회는 탈퇴뿐).
import { isConsentCurrent } from '@/domain/play/dataConsent';
import { useAuth } from '@/store/authStore';

/** 지금 이 순간의 동의 여부. 비로그인·서버 값 없음·판 불일치는 false. 플레이 시작 시점에 읽는다 */
export function readCurrentConsent(): boolean {
  const s = useAuth.getState();
  return s.status === 'authenticated' && isConsentCurrent(s.user?.dataConsent);
}
