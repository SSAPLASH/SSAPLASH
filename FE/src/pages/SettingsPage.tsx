// 설정 화면(/settings, ACCT-001, Figma 03 Screens / 설정). 계정·기기·오디오 / 연주·회원 탈퇴 카드.
// 값은 settingsStore에 바로 저장한다. 연주 기록 활용 동의는 가입 때 필수이고 철회는 탈퇴뿐이라 토글이 없다.
// "데이터 활용" 카드(설계 COACH-004-recommendation-consent D7)는 선택 동의인 맞춤 곡 추천 학습 활용만 토글로 켜고 끈다. 상태는 서버가 원본이다.
// 탈퇴 열림·진행·오류 상태는 여기서 정하고 WithdrawDialog는 표시만 한다. 탈퇴 성공 후엔 로그인 화면으로 간다.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ConnectionDots } from '@/components/stick/ConnectionDots';
import { KitSkinCarousel } from '@/components/settings/KitSkinCarousel';
import { SettingRow } from '@/components/settings/SettingRow';
import { WithdrawDialog } from '@/components/shell/WithdrawDialog';
import { useShell } from '@/components/shell/useShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Slider } from '@/components/ui/Slider';
import { Toast, type ToastVariant } from '@/components/ui/Toast';
import { Toggle } from '@/components/ui/Toggle';
import { Dialog } from '@/components/ui/Dialog';
import { recommendationConsentEnabled, SIGNUP_TERMS } from '@/domain/signupTerms';
import type { SocialProvider } from '@/domain/auth';
import { consentSaveErrorMessage, consentStatusText, isRecommendationVersionStale } from '@/domain/recommendationConsent';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import { useSettings } from '@/store/settingsStore';
import '@/components/settings/settings.css';

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  GOOGLE: 'Google',
  SSAFY: 'SSAFY',
};

/** 동의 저장 결과 토스트가 보이는 시간 */
const TOAST_MS = 3000;

/** 지연 보정 표시: +20ms · 0ms · -10ms */
function offsetText(ms: number): string {
  return `${ms > 0 ? '+' : ''}${ms}ms`;
}

export function SettingsPage() {
  useShell({ title: '설정' });
  const navigate = useNavigate();

  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const withdraw = useAuth((s) => s.withdraw);

  const sensorKind = useSettings((s) => s.sensorKind);
  const activePresetId = useSettings((s) => s.activePresetId);
  const volume = useSettings((s) => s.volume);
  const setVolume = useSettings((s) => s.setVolume);
  const drumVolume = useSettings((s) => s.drumVolume);
  const setDrumVolume = useSettings((s) => s.setDrumVolume);
  const songVolume = useSettings((s) => s.songVolume);
  const setSongVolume = useSettings((s) => s.setSongVolume);
  const audioOffsetMs = useSettings((s) => s.audioOffsetMs);
  const setAudioOffsetMs = useSettings((s) => s.setAudioOffsetMs);
  const kitSkin = useSettings((s) => s.kitSkin);
  const setKitSkin = useSettings((s) => s.setKitSkin);
  const liveCoach = useSettings((s) => s.liveCoach);
  const setLiveCoach = useSettings((s) => s.setLiveCoach);

  const connected = useLive((l) => l.connected);
  const referenceSetAt = useLive((l) => l.referenceSetAt);
  const presetItems = usePresets((p) => p.items);

  const consentStatus = useRecommendationConsent((s) => s.status);
  const consent = useRecommendationConsent((s) => s.consent);
  const consentSaving = useRecommendationConsent((s) => s.saving);
  const [consentConfirmOpen, setConsentConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ variant: ToastVariant; text: string } | null>(null);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // 프리셋 이름을 쓰려면 목록이 필요하다(드럼 세팅과 같이 진입 때 읽는다)
  useEffect(() => {
    void usePresets.getState().refresh();
  }, []);

  // 학습 동의 상태는 로그인한 계정만 읽는다(비로그인·인증 끔 개발 모드는 카드가 없다). 이미 읽었으면 재요청하지 않는다(store가 세션당 1회)
  const loggedIn = user !== null;
  useEffect(() => {
    if (loggedIn) void useRecommendationConsent.getState().load();
  }, [loggedIn]);

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const consentChecked = consent?.agreed === true;
  const consentStale = isRecommendationVersionStale(consent);
  const consentLocked = consentStatus !== 'ready' || consentSaving;

  const onToggleConsent = (next: boolean) => {
    if (next) { setConsentConfirmOpen(true); return; }
    saveConsent(false);
  };
  const saveConsent = (next: boolean) => {
    useRecommendationConsent
      .getState()
      .set(next)
      .then(
        () => { setConsentConfirmOpen(false); setToast(next ? null : { variant: 'info', text: '동의를 철회했어요' }); },
        (e: unknown) => setToast({ variant: 'error', text: consentSaveErrorMessage(e) }),
      );
  };

  const sensorMode = sensorKind !== 'none';
  const [left, right] = connected;
  const connText = !sensorMode ? '키보드 전용' : left && right ? '연결됨' : left || right ? '한 손만 연결됨' : '연결 안 됨';
  const connTone = sensorMode && left && right ? 'good' : sensorMode ? 'warn' : '';
  const presetName = presetItems.find((p) => p.id === activePresetId)?.name ?? '프리셋 없음';
  const presetValue = sensorMode ? `${presetName} · ${referenceSetAt !== null ? '보정 완료' : '보정 필요'}` : presetName;

  const onLogout = () => {
    void logout().then(() => navigate('/login', { replace: true }));
  };

  const openSetup = () => navigate('/setup', { state: { returnTo: '/settings', returnLabel: '설정' } });

  const openWithdraw = () => {
    setWithdrawError(null);
    setWithdrawOpen(true);
  };

  const onConfirmWithdraw = () => {
    setWithdrawBusy(true);
    setWithdrawError(null);
    withdraw().then(
      () => navigate('/login?error=withdrawn', { replace: true }),
      (e: unknown) => {
        // pages는 api를 import하지 않으므로 ApiError는 구조로 구분한다
        const { status, detail } = e instanceof Error ? (e as { status?: unknown; detail?: unknown }) : {};
        // 401은 탈퇴가 아니라 세션 만료다. store가 anonymous로 내렸으므로 RequireAuth가 로그인 화면으로 보낸다
        if (status === 401) return;
        setWithdrawError(typeof detail === 'string' && detail ? detail : '요청을 보내지 못했습니다. 다시 시도해 주세요.');
        setWithdrawBusy(false);
      },
    );
  };

  return (
    <main className="main">
      <header className="settings-head">
        <h1>설정</h1>
        <p>계정, 기기, 오디오, 연주 설정을 관리해요.</p>
      </header>

      <div className="settings-cols">
        <div className="settings-col">
          <Card padding="lg" title="계정">
            {user ? (
              <div className="settings-account">
                {user.profileImageUrl ? (
                  <img className="settings-avatar" src={user.profileImageUrl} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="settings-avatar settings-avatar-initial" aria-hidden="true">
                    {Array.from(user.nickname)[0] ?? '?'}
                  </span>
                )}
                <div className="settings-account-text">
                  <span className="settings-account-name">{user.nickname}</span>
                  <span className="settings-account-sub">{PROVIDER_LABEL[user.provider] ?? user.provider} 계정으로 로그인</span>
                </div>
                <Button variant="secondary" size="sm" onClick={onLogout}>
                  로그아웃
                </Button>
              </div>
            ) : (
              // 인증 끔 개발 모드에서만 여기 온다. 운영 빌드는 RequireAuth가 로그인 화면으로 보낸다
              <p className="settings-desc">
                <Link to="/login">로그인</Link>하면 계정을 관리할 수 있어요.
              </p>
            )}
          </Card>

          {user && (
            <Card padding="lg" title="데이터 활용">
              <p className="settings-note">연주 기록 활용 동의(필수)는 회원 탈퇴로만 철회돼요.</p>
              {(recommendationConsentEnabled() || consentChecked) && <SettingRow label="맞춤 곡 추천 학습 활용" help="동의 상태를 확인하고 철회할 수 있어요.">
                {(aria) => <Toggle {...aria} label="맞춤 곡 추천 학습 활용" checked={consentChecked} disabled={consentLocked} onChange={onToggleConsent} />}
              </SettingRow>}
              {consentStatus === 'ready' && <p className="settings-note">{consentStatusText(consent)}</p>}
              {consentStale && recommendationConsentEnabled() && <Button variant="text" disabled={consentLocked} onClick={() => setConsentConfirmOpen(true)}>새 동의 내용 확인</Button>}
              {consentStatus === 'error' && <div role="alert"><p className="settings-note">동의 상태를 불러오지 못했어요</p><Button variant="text" onClick={() => void useRecommendationConsent.getState().load()}>다시 시도</Button></div>}
              {consentConfirmOpen && recommendationConsentEnabled() && (
                <Dialog labelledBy="settings-recommend-consent-title" onClose={() => setConsentConfirmOpen(false)}>
                  <h2 id="settings-recommend-consent-title">맞춤 곡 추천 학습 활용 동의</h2>
                  {(SIGNUP_TERMS.find((t) => t.id === 'recommendation')?.body ?? '').split('\n').map((line) => <p key={line}>{line}</p>)}
                  <div className="dialog-actions"><Button variant="secondary" onClick={() => setConsentConfirmOpen(false)}>취소</Button><Button disabled={consentLocked} onClick={() => saveConsent(true)}>동의</Button></div>
                </Dialog>
              )}
            </Card>
          )}

          <Card padding="lg" title="기기">
            <SettingRow label="스틱 연결" help="왼손·오른손 스틱 상태">
              {() => (
                <div className="settings-conn">
                  {sensorMode && <ConnectionDots left={left} right={right} />}
                  <span className={`settings-value ${connTone}`}>{connText}</span>
                </div>
              )}
            </SettingRow>
            <SettingRow label="프리셋 · 보정" help="드럼 배치와 보정은 드럼 세팅에서 바꿔요">
              {() => (
                <>
                  <span className="settings-value">{presetValue}</span>
                  <Button variant="text" size="sm" onClick={openSetup}>
                    드럼 세팅 열기
                  </Button>
                </>
              )}
            </SettingRow>
          </Card>

          <Card padding="lg" title="오디오">
            <SettingRow label="전체 음량" help="모든 소리의 크기" wideControl>
              {(aria) => (
                <Slider
                  {...aria}
                  label="전체 음량"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  valueText={`${Math.round(volume * 100)}%`}
                  onChange={setVolume}
                />
              )}
            </SettingRow>
            <SettingRow label="드럼 음량" help="패드 소리만. 100%가 기본" wideControl>
              {(aria) => (
                <Slider
                  {...aria}
                  label="드럼 음량"
                  min={0}
                  max={2}
                  step={0.05}
                  value={drumVolume}
                  valueText={`${Math.round(drumVolume * 100)}%`}
                  onChange={setDrumVolume}
                />
              )}
            </SettingRow>
            <SettingRow label="노래 음량" help="게임·악보 반주만" wideControl>
              {(aria) => (
                <Slider
                  {...aria}
                  label="노래 음량"
                  min={0}
                  max={1}
                  step={0.05}
                  value={songVolume}
                  valueText={`${Math.round(songVolume * 100)}%`}
                  onChange={setSongVolume}
                />
              )}
            </SettingRow>
            <SettingRow label="타격음 지연 보정" help="치는 순간보다 소리가 늦게 들리면 값을 올리세요" wideControl>
              {(aria) => (
                <Slider
                  {...aria}
                  label="타격음 지연 보정"
                  min={-100}
                  max={200}
                  step={5}
                  value={audioOffsetMs}
                  valueText={offsetText(audioOffsetMs)}
                  onChange={setAudioOffsetMs}
                />
              )}
            </SettingRow>
            <p className="settings-help">메트로놈은 상단 Dock에서도 바꿀 수 있어요.</p>
          </Card>
        </div>

        <div className="settings-col">
          <Card padding="lg" title="연주">
            <SettingRow label="드럼 모양" help="연주 화면 드럼 킷의 생김새예요. 넘기면 바로 바뀌고, 이 기기에만 저장돼요" stacked>
              {(aria) => <KitSkinCarousel value={kitSkin} onChange={setKitSkin} labelledBy={aria['aria-labelledby']} />}
            </SettingRow>
            <SettingRow label="실시간 코칭" help="리듬 게임·악보 연습 공통. 연주 중 늦음·빠름·연속 MISS 같은 신호를 드럼 옆 안내 칸에 3초간 띄워요.">
              {(aria) => <Toggle {...aria} label="실시간 코칭" checked={liveCoach} onChange={setLiveCoach} />}
            </SettingRow>
            <p className="settings-note">연주를 시작할 때의 값이 그 판에 적용돼요. 끄면 코칭 문구가 뜨지 않아요.</p>
          </Card>

          {user && (
            <Card padding="lg" title="회원 탈퇴" className="settings-danger">
              <p className="settings-desc">
                계정과 라이브러리, 연주 기록이 삭제되고 되돌릴 수 없어요. 동의한 연주 기록은 신원 정보 없이 남아요.
              </p>
              <div>
                <Button variant="danger" size="sm" onClick={openWithdraw}>
                  회원 탈퇴
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Toast variant={toast?.variant ?? 'info'} text={toast?.text ?? null} regionClassName="settings-toast-region" />

      <WithdrawDialog
        open={withdrawOpen}
        busy={withdrawBusy}
        error={withdrawError}
        onCancel={() => setWithdrawOpen(false)}
        onConfirm={onConfirmWithdraw}
      />
    </main>
  );
}
