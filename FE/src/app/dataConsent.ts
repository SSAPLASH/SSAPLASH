// 연주 기록 활용 동의 접착 (설계 COACH-003-signup-consent D17·D18).
// 플레이 시작 시점 값 읽기와, 옛 브라우저 저장값(statsConsent)을 서버로 한 번 옮기는 구독을 둔다.
import { isConsentCurrent, legacyConsentAction } from '@/domain/dataConsent';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';

/** 지금 이 순간의 동의 여부. 비로그인·서버 값 없음·판 불일치는 false. 플레이 시작 시점에 읽는다 */
export function readCurrentConsent(): boolean {
  const s = useAuth.getState();
  return s.status === 'authenticated' && isConsentCurrent(s.user?.dataConsent);
}

/**
 * 로그인이 확정될 때(authenticated 전이) 한 번 옛 브라우저 값을 정리한다(설계 D17).
 * 서버가 답한 적 없고 브라우저가 true면 PUT 뒤 false로 비우고, 서버에 값이 있으면 올리지 않고 비운다.
 * 실패하면 그대로 두어 다음 로그인에 다시 시도한다. 묶을 때 이미 로그인 상태면 그때 한 번 돈다. 해제 함수를 돌려준다(테스트용)
 */
export function bindLegacyConsentUpload(): () => void {
  const handle = () => {
    const user = useAuth.getState().user;
    if (!user) return;
    const action = legacyConsentAction(user.dataConsent, useSettings.getState().statsConsent);
    if (action === 'upload') {
      useAuth
        .getState()
        .setDataConsent(true)
        .then(
          () => useSettings.getState().setStatsConsent(false),
          () => {
            /* 실패: 다음 로그인에 다시 시도 */
          },
        );
    } else if (action === 'clear') {
      useSettings.getState().setStatsConsent(false);
    }
  };
  if (useAuth.getState().status === 'authenticated') handle();
  return useAuth.subscribe((s, prev) => {
    if (prev.status !== 'authenticated' && s.status === 'authenticated') handle();
  });
}
