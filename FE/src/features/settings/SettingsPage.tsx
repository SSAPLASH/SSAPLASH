// 설정 화면(/settings, ACCT-001). 소리·메트로놈·판정·진행·화면 표시·꾸미기·계정·데이터 활용을 구역별로 표시한다.
// 여기에는 앱 동작·표시 값만 둔다. 스틱·기기에 맞추는 값(박자 맞추기·판정 타이밍·패드 인식 범위)은 드럼 세팅(/setup)에 있다.
// 값은 settingsStore에 바로 저장한다. 연주 기록 활용 동의는 가입 때 필수이고 철회는 탈퇴뿐이라 토글이 없다.
// "데이터 활용" 구역(설계 COACH-004-recommendation-consent D7)는 선택 동의인 맞춤 곡 추천 학습 활용만 토글로 켜고 끈다. 상태는 서버가 원본이다.
// 탈퇴 열림·진행·오류 상태는 여기서 정하고 WithdrawDialog는 표시만 한다. 탈퇴 성공 후엔 로그인 화면으로 간다.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KitSkinCarousel } from '@/features/settings/components/KitSkinCarousel';
import { HitFxPicker } from '@/features/settings/components/HitFxPicker';
import { SettingRow } from './SettingRow';
import { WithdrawDialog } from '@/features/settings/components/WithdrawDialog';
import { useShell } from '@/components/shell/nav/useShell';
import { Button } from '@/components/ui/action/Button';
import { Segmented } from '@/components/ui/form/Segmented';
import { SUBDIVISION_LABEL, SUBDIVISION_PREFS, resolveSubdivision, type SubdivisionPref } from '@/domain/time/metronome';
import { metronomePreview } from '@/runtime/metronomePreview';
import { Slider } from '@/components/ui/form/Slider';
import { Toast, type ToastVariant } from '@/components/ui/feedback/Toast';
import { Toggle } from '@/components/ui/form/Toggle';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { recommendationConsentEnabled, SIGNUP_TERMS } from '@/domain/account/signupTerms';
import type { SocialProvider } from '@/domain/account/auth';
import { consentSaveErrorMessage, consentStatusText, isRecommendationVersionStale } from '@/domain/account/recommendationConsent';
import { useAuth } from '@/store/authStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import { useSettings, type PlayHaptic } from '@/store/settingsStore';
import './settings.css';
import { InlineError } from '@/components/ui/feedback/InlineError';

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  GOOGLE: 'Google',
  SSAFY: 'SSAFY',
};

const SUBDIVISION_OPTIONS = SUBDIVISION_PREFS.map((value) => ({ value, label: SUBDIVISION_LABEL[value] }));

/** 타격 진동 방식 선택지(모니터 빌드 전용, PLAY-006) */
const HAPTIC_OPTIONS: { value: PlayHaptic; label: string }[] = [
  { value: 'judgement', label: '판정 진동' },
  { value: 'local', label: '스틱 즉시 진동' },
];

/** 동의 저장 결과 토스트가 보이는 시간 */
const TOAST_MS = 3000;

export function SettingsPage() {
  useShell({ title: '설정' });
  const navigate = useNavigate();

  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const withdraw = useAuth((s) => s.withdraw);

  const volume = useSettings((s) => s.volume);
  const setVolume = useSettings((s) => s.setVolume);
  const drumVolume = useSettings((s) => s.drumVolume);
  const setDrumVolume = useSettings((s) => s.setDrumVolume);
  const songVolume = useSettings((s) => s.songVolume);
  const setSongVolume = useSettings((s) => s.setSongVolume);
  const metronomeSubdivision = useSettings((s) => s.metronomeSubdivision);
  const setMetronomeSubdivision = useSettings((s) => s.setMetronomeSubdivision);
  const metronome = useSettings((s) => s.metronome);
  const setMetronome = useSettings((s) => s.setMetronome);
  const timing = useSettings((s) => s.timing);
  const setTiming = useSettings((s) => s.setTiming);
  const scrollMs = useSettings((s) => s.scrollMs);
  const setScrollMs = useSettings((s) => s.setScrollMs);
  const countInBars = useSettings((s) => s.countInBars);
  const setCountInBars = useSettings((s) => s.setCountInBars);
  const kitSkin = useSettings((s) => s.kitSkin);
  const setKitSkin = useSettings((s) => s.setKitSkin);
  const hitFxTheme = useSettings((s) => s.hitFxTheme);
  const setHitFxTheme = useSettings((s) => s.setHitFxTheme);
  const liveCoach = useSettings((s) => s.liveCoach);
  const setLiveCoach = useSettings((s) => s.setLiveCoach);
  const timingBar = useSettings((s) => s.timingBar);
  const setTimingBar = useSettings((s) => s.setTimingBar);
  const gameGuide = useSettings((s) => s.gameGuide);
  const setGameGuide = useSettings((s) => s.setGameGuide);
  const playHaptic = useSettings((s) => s.playHaptic);
  const setPlayHaptic = useSettings((s) => s.setPlayHaptic);

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

      <div className="settings-grid">
        <div className="settings-col">
          <section className="settings-section" aria-labelledby="settings-sound">
            <h3 id="settings-sound" className="settings-section-title">소리</h3>
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
          </section>

          <section className="settings-section" aria-labelledby="settings-metronome">
            <h3 id="settings-metronome" className="settings-section-title">메트로놈</h3>
            <SettingRow label="플레이 중 메트로놈" help="곡을 연주하는 동안 박자 클릭을 함께 들려줘요.">
              {(aria) => <Toggle {...aria} label="플레이 중 메트로놈" checked={metronome} onChange={setMetronome} />}
            </SettingRow>
            <SettingRow label="메트로놈 박 분할" help="자동은 BPM 90 미만에서 8분음표로 울려요." wideControl>
              {() => (
                <Segmented<SubdivisionPref>
                  label="메트로놈 박 분할"
                  options={SUBDIVISION_OPTIONS}
                  value={metronomeSubdivision}
                  onChange={(v) => {
                    setMetronomeSubdivision(v);
                    // 고른 값을 메트로놈 BPM으로 두 박 들려준다(메트로놈이 울리는 중이면 나지 않는다)
                    const bpm = useSettings.getState().metronomeBpm;
                    void metronomePreview.play('settings', bpm, resolveSubdivision(v, bpm));
                  }}
                />
              )}
            </SettingRow>
            <p className="settings-help">메트로놈 음량과 빠르기는 연주 화면 상단 Dock에서 바꿀 수 있어요.</p>
          </section>

          <section className="settings-section" aria-labelledby="settings-judge">
            <h3 id="settings-judge" className="settings-section-title">판정·진행</h3>
            <SettingRow label="판정 폭 Perfect" help="이 범위 안에 치면 Perfect예요. 넓힐수록 쉬워져요." wideControl>
              {(aria) => (
                <Slider
                  {...aria}
                  label="판정 폭 Perfect"
                  min={10}
                  max={60}
                  step={5}
                  value={timing.perfectMs}
                  valueText={`±${timing.perfectMs}ms`}
                  onChange={(v) => setTiming({ ...timing, perfectMs: v })}
                />
              )}
            </SettingRow>
            <SettingRow label="판정 폭 Good" help="이 범위 안에 치면 Good, 벗어나면 Miss예요." wideControl>
              {(aria) => (
                <Slider
                  {...aria}
                  label="판정 폭 Good"
                  min={30}
                  max={150}
                  step={5}
                  value={timing.goodMs}
                  valueText={`±${timing.goodMs}ms`}
                  onChange={(v) => setTiming({ ...timing, goodMs: v })}
                />
              )}
            </SettingRow>
            <p className="settings-note">판정 폭 Good을 기본값보다 넓히면 결과 화면에 표시돼요.</p>
            <SettingRow label="노트 낙하 시간" help="노트가 판정선까지 내려오는 시간이에요. 짧을수록 빨라요." wideControl>
              {(aria) => (
                <Slider
                  {...aria}
                  label="노트 낙하 시간"
                  min={600}
                  max={3000}
                  step={100}
                  value={scrollMs}
                  valueText={`${scrollMs}ms`}
                  onChange={setScrollMs}
                />
              )}
            </SettingRow>
            <SettingRow label="카운트다운" help="연주 시작 전에 한 마디를 세어 줘요.">
              {(aria) => <Toggle {...aria} label="카운트다운" checked={countInBars > 0} onChange={(v) => setCountInBars(v ? 1 : 0)} />}
            </SettingRow>
            <p className="settings-help">
              박자 맞추기와 판정 타이밍은 <Link to="/setup">드럼 세팅</Link>에서 맞춰요.
            </p>
          </section>
        </div>

        <div className="settings-col">
          <section className="settings-section" aria-labelledby="settings-view">
            <h3 id="settings-view" className="settings-section-title">화면 표시</h3>
            <SettingRow label="실시간 코칭" help="연주 중 늦음·빠름·연속 MISS를 드럼 옆에 알려 줘요.">
              {(aria) => <Toggle {...aria} label="실시간 코칭" checked={liveCoach} onChange={setLiveCoach} />}
            </SettingRow>
            <SettingRow label="타이밍 막대" help="최근 타격이 빠른지 늦은지를 눈금으로 보여 줘요.">
              {(aria) => <Toggle {...aria} label="타이밍 막대" checked={timingBar} onChange={setTimingBar} />}
            </SettingRow>
            <SettingRow label="리듬 게임 가이드" help="다음에 칠 패드를 점선과 박 번호로 미리 보여 줘요.">
              {(aria) => <Toggle {...aria} label="리듬 게임 가이드" checked={gameGuide} onChange={setGameGuide} />}
            </SettingRow>
            {import.meta.env.VITE_MONITOR === 'true' && (
              <SettingRow label="타격 진동 방식" help="연주 중 진동을 판정 결과로 낼지 스틱이 치는 즉시 낼지 고릅니다." wideControl>
                {() => (
                  <Segmented<PlayHaptic>
                    label="타격 진동 방식"
                    options={HAPTIC_OPTIONS}
                    value={playHaptic}
                    onChange={setPlayHaptic}
                  />
                )}
              </SettingRow>
            )}
          </section>

          <section className="settings-section" aria-labelledby="settings-deco">
            <h3 id="settings-deco" className="settings-section-title">꾸미기</h3>
            <SettingRow label="드럼 모양" help="연주 화면 드럼 킷의 생김새예요. 넘기면 바로 바뀌고, 이 기기에만 저장돼요" stacked>
              {(aria) => <KitSkinCarousel value={kitSkin} onChange={setKitSkin} labelledBy={aria['aria-labelledby']} />}
            </SettingRow>
            <SettingRow label="타격 이펙트" help="패드를 칠 때 나오는 효과예요. 넘기면 바로 바뀌고, 이 기기에만 저장돼요" stacked>
              {(aria) => <HitFxPicker value={hitFxTheme} onChange={setHitFxTheme} skin={kitSkin} labelledBy={aria['aria-labelledby']} />}
            </SettingRow>
          </section>
        </div>

          <section className="settings-section" aria-labelledby="settings-account">
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
            <section className="settings-section" aria-labelledby="settings-data">
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
