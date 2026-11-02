// 설정 「연주 기록 활용 (선택)」 카드 (설계 COACH-003-signup-consent D14·D16).
// 값은 서버 dataConsent(authStore user)에서 파생한다. 누르면 바뀐 값을 바로 보이고 잠근 뒤 저장하며,
// 실패하면 원래 값으로 돌아가고 오류 문장을 보인다. api/는 import하지 않는다.
import { useState } from 'react';
import { SettingRow } from '@/components/settings/SettingRow';
import { Card } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { isConsentCurrent } from '@/domain/dataConsent';
import { dataConsentVersion } from '@/domain/signupTerms';
import { useAuth } from '@/store/authStore';

export function DataConsentCard() {
  const user = useAuth((s) => s.user);
  const setDataConsent = useAuth((s) => s.setDataConsent);
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = isConsentCurrent(user?.dataConsent);
  // 동의했지만 문구 판이 달라진 경우: 꺼져 보이고 안내한다
  const outdated = user?.dataConsent?.agreed === true && user.dataConsent.version !== dataConsentVersion();
  const shown = pending ?? current;

  const onChange = (next: boolean) => {
    setError(null);
    setPending(next);
    setBusy(true);
    setDataConsent(next)
      .then(
        () => {
          // 성공: store 값이 갱신돼 화면 값이 유지된다
        },
        (e: unknown) => {
          const { detail } = e instanceof Error ? (e as { detail?: unknown }) : {};
          setError(typeof detail === 'string' && detail ? detail : '저장하지 못했습니다. 다시 시도해 주세요.');
        },
      )
      .finally(() => {
        setPending(null);
        setBusy(false);
      });
  };

  return (
    <Card padding="lg" title="연주 기록 활용 (선택)">
      <SettingRow
        label="약점 분석 기준 개선에 연주 기록 쓰기"
        help="타격 기록만 비식별 처리해 통계에 써요. 꺼도 모든 기능을 그대로 쓸 수 있어요."
      >
        {(aria) => <Toggle {...aria} label="연주 기록 활용" checked={shown} disabled={busy || !user} onChange={onChange} />}
      </SettingRow>
      {outdated && <p className="settings-note">동의 문구가 바뀌어 다시 켜야 해요.</p>}
      <p className="settings-note">끄면 다음 연주부터 쓰지 않아요. 이미 통계에 반영된 값은 개인별로 지울 수 없어요.</p>
      {error && (
        <p className="settings-note" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
