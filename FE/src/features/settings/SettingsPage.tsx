// 설정 화면(/settings, ACCT-001). 오디오·연주·계정·데이터 활용을 구역별로 표시한다.
// 값은 settingsStore에 바로 저장한다. 연주 기록 활용 동의는 가입 때 필수이고 철회는 탈퇴뿐이라 토글이 없다.
// "데이터 활용" 구역(설계 COACH-004-recommendation-consent D7)는 선택 동의인 맞춤 곡 추천 학습 활용만 토글로 켜고 끈다. 상태는 서버가 원본이다.
// 탈퇴 열림·진행·오류 상태는 여기서 정하고 WithdrawDialog는 표시만 한다. 탈퇴 성공 후엔 로그인 화면으로 간다.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KitSkinCarousel } from '@/components/fx/KitSkinCarousel';
import { HitFxPicker } from '@/components/fx/HitFxPicker';
import { SettingRow } from './SettingRow';
import { WithdrawDialog } from '@/components/shell/WithdrawDialog';
import { useShell } from '@/components/shell/useShell';
import { Button } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Slider';
import { Toast, type ToastVariant } from '@/components/ui/Toast';
import { Toggle } from '@/components/ui/Toggle';
import { Dialog } from '@/components/ui/Dialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { TimingCalDialog } from '@/components/calibration/TimingCalDialog';
import { outputLatencyWarnText, timingCalMismatchText, timingCalRecordText, timingOffsetText } from '@/components/calibration/timingCalText';
import { TIMING_OFFSET_MAX_MS, TIMING_OFFSET_MIN_MS, TIMING_OFFSET_STEP_MS } from '@/domain/kit/timingCalibration';
import { audioEngine } from '@/audio/AudioEngine';
import { recommendationConsentEnabled, SIGNUP_TERMS } from '@/domain/signupTerms';
import type { SocialProvider } from '@/domain/auth';
import { consentSaveErrorMessage, consentStatusText, isRecommendationVersionStale } from '@/domain/account/recommendationConsent';
import { useAuth } from '@/store/authStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import { useSettings } from '@/store/settingsStore';
import './settings.css';
import { InlineError } from '@/components/ui/InlineError';

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  GOOGLE: 'Google',
  SSAFY: 'SSAFY',
};

/** 동의 저장 결과 토스트가 보이는 시간 */
const TOAST_MS = 3000;

export function SettingsPage() {
  useShell({ title: '설정' });
  const navigate = useNavigate();

  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const withdraw = useAuth((s) => s.withdraw);

  const sensorKind = useSettings((s) => s.sensorKind);
  const volume = useSettings((s) => s.volume);
  const setVolume = useSettings((s) => s.setVolume);
  const drumVolume = useSettings((s) => s.drumVolume);
  const setDrumVolume = useSettings((s) => s.setDrumVolume);
  const songVolume = useSettings((s) => s.songVolume);
  const setSongVolume = useSettings((s) => s.setSongVolume);
  const audioOffsetMs = useSettings((s) => s.audioOffsetMs);
  const setAudioOffsetMs = useSettings((s) => s.setAudioOffsetMs);
  const timingCal = useSettings((s) => s.timingCal);
  const [timingCalOpen, setTimingCalOpen] = useState(false);
  const kitSkin = useSettings((s) => s.kitSkin);
  const setKitSkin = useSettings((s) => s.setKitSkin);
  const hitFxTheme = useSettings((s) => s.hitFxTheme);
  const setHitFxTheme = useSettings((s) => s.setHitFxTheme);
  const liveCoach = useSettings((s) => s.liveCoach);
  const setLiveCoach = useSettings((s) => s.setLiveCoach);
  const timingBar = useSettings((s) => s.timingBar);
  const setTimingBar = useSettings((s) => s.setTimingBar);

  const consentStatus = useRecommendationConsent((s) => s.status);
  const consent = useRecommendationConsent((s) => s.consent);
  const consentSaving = useRecommendationConsent((s) => s.saving);
  const [consentConfirmOpen, setConsentConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ variant: ToastVariant; text: string } | null>(null);

  // 불러오지 못한 프로필 사진 URL. 이니셜로 바꾼다
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // 학습 동의 상태는 로그인한 계정만 읽는다(비로그인·인증 끔 개발 모드는 구역이 없다). 이미 읽었으면 재요청하지 않는다(store가 세션당 1회)
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
  // 박자 맞추기 안내: 측정한 입력과 지금 입력이 다르거나, 보고된 출력 지연이 크면 한 줄씩 보인다
  const timingMismatch = timingCalMismatchText(timingCal, sensorMode);
  const latencyWarn = outputLatencyWarnText(audioEngine.latency()?.outputLatencyMs);

  const onLogout = () => {
    void logout().then(() => navigate('/', { replace: true }));
  };

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
      <PageHeader className="settings-head" title="설정" />

      <div className={`settings-grid${user ? ' has-data' : ''}`}>
          <section className="settings-section settings-section--audio" aria-labelledby="settings-audio">
            <h3 id="settings-audio" className="settings-section-title">오디오</h3>
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
            <SettingRow label="박자 맞추기" help="클릭 소리에 맞춰 치면 판정 타이밍을 자동으로 맞춰요">
              {() => (
                <Button variant="secondary" size="sm" onClick={() => setTimingCalOpen(true)}>
                  {timingCal ? '다시 맞추기' : '맞추기'}
                </Button>
              )}
            </SettingRow>
            <p className="settings-note">{timingCalRecordText(timingCal)}</p>
            {timingMismatch && <p className="settings-note">{timingMismatch}</p>}
            {latencyWarn && <p className="settings-note">{latencyWarn}</p>}
            <SettingRow label="판정 타이밍 보정" help="판정이 빠르게 나오면 내리고, 늦게 나오면 올리세요" wideControl>
              {(aria) => (
                <Slider
                  {...aria}
                  label="판정 타이밍 보정"
                  min={TIMING_OFFSET_MIN_MS}
                  max={TIMING_OFFSET_MAX_MS}
                  step={TIMING_OFFSET_STEP_MS}
                  value={audioOffsetMs}
                  valueText={timingOffsetText(audioOffsetMs)}
                  onChange={setAudioOffsetMs}
                />
              )}
            </SettingRow>
            <p className="settings-help">메트로놈은 연주 화면 상단 Dock에서도 바꿀 수 있어요.</p>
          </section>

          <section className="settings-section settings-section--play" aria-labelledby="settings-play">
            <h3 id="settings-play" className="settings-section-title">연주</h3>
            <SettingRow label="실시간 코칭" help="리듬 게임·악보 연습 공통. 연주 중 늦음·빠름·연속 MISS 같은 신호를 드럼 옆 안내 칸에 3초간 띄워요.">
              {(aria) => <Toggle {...aria} label="실시간 코칭" checked={liveCoach} onChange={setLiveCoach} />}
            </SettingRow>
            <p className="settings-note">연주를 시작할 때의 값이 그 판에 적용돼요. 끄면 코칭 문구가 뜨지 않아요.</p>
            <SettingRow label="타이밍 막대" help="리듬 게임 판정선 아래·악보 아래에 최근 타격이 빠른지 늦은지를 눈금으로 보여줘요. 판정 범위를 벗어나면 막대 바깥에 빨간 점으로 보여줘요. 바로 적용되고, 이 기기에만 저장돼요.">
              {(aria) => <Toggle {...aria} label="타이밍 막대" checked={timingBar} onChange={setTimingBar} />}
            </SettingRow>
            <SettingRow label="드럼 모양" help="연주 화면 드럼 킷의 생김새예요. 넘기면 바로 바뀌고, 이 기기에만 저장돼요" stacked>
              {(aria) => <KitSkinCarousel value={kitSkin} onChange={setKitSkin} labelledBy={aria['aria-labelledby']} />}
            </SettingRow>
            <SettingRow label="타격 이펙트" help="패드를 칠 때 나오는 효과예요. 넘기면 바로 바뀌고, 이 기기에만 저장돼요" stacked>
              {(aria) => <HitFxPicker value={hitFxTheme} onChange={setHitFxTheme} skin={kitSkin} labelledBy={aria['aria-labelledby']} />}
            </SettingRow>
          </section>

          <section className="settings-section settings-section--account" aria-labelledby="settings-account">
            <h3 id="settings-account" className="settings-section-title">계정</h3>
            {user ? (
              <div className="settings-account">
                {user.profileImageUrl && user.profileImageUrl !== failedAvatar ? (
                  <img
                    className="settings-avatar"
                    src={user.profileImageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setFailedAvatar(user.profileImageUrl)}
                  />
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
          </section>

          {user && (
            <section className="settings-section settings-section--data" aria-labelledby="settings-data">
              <h3 id="settings-data" className="settings-section-title">데이터 활용</h3>
              <p className="settings-note">연주 기록 활용 동의(필수)는 회원 탈퇴로만 철회돼요.</p>
              {(recommendationConsentEnabled() || consentChecked) && <SettingRow label="맞춤 곡 추천 학습 활용" help="동의 상태를 확인하고 철회할 수 있어요.">
                {(aria) => <Toggle {...aria} label="맞춤 곡 추천 학습 활용" checked={consentChecked} disabled={consentLocked} onChange={onToggleConsent} />}
              </SettingRow>}
              {consentStatus === 'ready' && <p className="settings-note">{consentStatusText(consent)}</p>}
              {consentStale && recommendationConsentEnabled() && <Button variant="text" disabled={consentLocked} onClick={() => setConsentConfirmOpen(true)}>새 동의 내용 확인</Button>}
              {consentStatus === 'error' && <InlineError plain onRetry={() => void useRecommendationConsent.getState().load()}>동의 상태를 불러오지 못했어요</InlineError>}
              {consentConfirmOpen && recommendationConsentEnabled() && (
                <Dialog labelledBy="settings-recommend-consent-title" onClose={() => setConsentConfirmOpen(false)}>
                  <h2 id="settings-recommend-consent-title">맞춤 곡 추천 학습 활용 동의</h2>
                  {(SIGNUP_TERMS.find((t) => t.id === 'recommendation')?.body ?? '').split('\n').map((line) => <p key={line}>{line}</p>)}
                  <div className="dialog-actions"><Button variant="secondary" onClick={() => setConsentConfirmOpen(false)}>취소</Button><Button disabled={consentLocked} onClick={() => saveConsent(true)}>동의</Button></div>
                </Dialog>
              )}
            </section>
          )}
      </div>

      {user && (
        <div className="settings-withdraw">
          <button type="button" className="settings-withdraw-button" onClick={openWithdraw}>회원 탈퇴</button>
        </div>
      )}

      {timingCalOpen && <TimingCalDialog onClose={() => setTimingCalOpen(false)} />}

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
