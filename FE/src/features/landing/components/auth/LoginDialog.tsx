// 로그인 팝업 (설계 UX-353, 3-7). 랜딩 위에 뜬다. 버튼은 BE 로그인 시작 주소로 브라우저를 통째로 보낸다(fetch 아님) — BE가 제공자 동의 화면으로 302.
// 표시할 제공자는 VITE_LOGIN_PROVIDERS로 거른다. 버튼은 Figma 로그인 카드 134:2733대로 로고 + 「…로 계속하기」.
// 돌아갈 경로가 모드(/free·/sheet·/play)면 어느 모드로 시작하는지 한 줄 안내한다.
import { useEffect, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { Button } from '@/components/ui/action/Button';
import { IconButton } from '@/components/ui/action/IconButton';
import { enabledProviders, loginErrorMessage, type ProviderKey } from '@/domain/account/auth';
import { modeForRoute } from '@/features/landing/domain/landingRoute';
import { LANDING_MODES } from '@/features/landing/components/landingContent';
import { useAuth } from '@/store/authStore';
import { GoogleIcon, SsafyIcon } from './ProviderIcons';
import './auth.css';

/** 키 없는 제공자는 FE 환경변수로 숨긴다 (빌드 시 고정) */
const PROVIDERS = enabledProviders(import.meta.env.VITE_LOGIN_PROVIDERS);
/** 제공자 버튼 왼쪽 로고 (Figma Icons / Google · Icons / SSAFY) */
const PROVIDER_ICON: Record<ProviderKey, ReactNode> = { google: <GoogleIcon />, ssafy: <SsafyIcon /> };

interface Props {
  /** 로그인 뒤 돌아갈 경로(검증된 값) */
  returnTo: string;
  /** `?error=` 코드. 모르는 코드·없음이면 문구를 보이지 않는다 */
  errorCode: string | null;
  onClose: () => void;
}

export function LoginDialog({ returnTo, errorCode, onClose }: Props) {
  const lostReason = useAuth((s) => s.lostReason);
  const clearLostReason = useAuth((s) => s.clearLostReason);
  const startLogin = useAuth((s) => s.startLogin);
  // BE(access_denied·oauth_failed)와 RequireAuth·콜백(no_session·session_expired·network) 모두 ?error=로 온다
  const message = loginErrorMessage(errorCode);
  const modeKey = modeForRoute(returnTo);
  const modeName = modeKey ? LANDING_MODES.find((m) => m.key === modeKey)?.name : null;

  // 사유는 URL에 이미 실렸으므로 store에서는 지운다 (다음 방문에 다시 붙지 않게)
  useEffect(() => {
    if (lostReason) clearLostReason();
  }, [lostReason, clearLostReason]);

  return (
    <Dialog onClose={onClose} labelledBy="login-dialog-title" className="auth-dialog login-dialog">
      <div className="login-dialog-head">
        <h2 id="login-dialog-title">로그인</h2>
        <IconButton size="sm" label="닫기" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconButton>
      </div>
      {modeName && <p className="login-dialog-mode">로그인하면 {modeName} 모드로 바로 시작합니다.</p>}
      <p className="dim login-dialog-desc">소셜 계정으로 로그인하면 세팅·프리셋과 플레이 기록이 계정에 저장됩니다. 이메일·비밀번호 가입은 없습니다.</p>
      {message && <p className={errorCode === 'withdrawn' ? 'notice' : 'notice error'}>{message}</p>}
      <div className="col login-dialog-buttons">
        {PROVIDERS.map((p) => (
          <Button
            key={p.key}
            variant="secondary"
            fullWidth
            leadingIcon={PROVIDER_ICON[p.key]}
            className="login-provider-btn"
            onClick={() => startLogin(p.key, returnTo)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <p className="login-dialog-caption">계정은 Google 또는 SSAFY 계정으로만 만들 수 있습니다.</p>
    </Dialog>
  );
}
