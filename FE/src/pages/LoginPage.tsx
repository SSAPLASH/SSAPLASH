// 로그인 화면 (설계 3-7). 버튼은 BE 로그인 시작 주소로 브라우저를 통째로 보낸다(fetch 아님) — BE가 제공자 동의 화면으로 302.
// PublicLayout 안에서 2분할(좌 브랜드·우 카드)로 그린다. 표시할 제공자는 VITE_LOGIN_PROVIDERS로 거른다.
import { useEffect } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/store/authStore';
import { enabledProviders, loginErrorMessage } from '@/domain/auth';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kitLayout';
import { KitCanvas } from '@/components/KitCanvas';

/** 키 없는 제공자는 FE 환경변수로 숨긴다 (빌드 시 고정) */
const PROVIDERS = enabledProviders(import.meta.env.VITE_LOGIN_PROVIDERS);
/** 제공자 버튼 왼쪽의 글자 마크 (외부 로고 에셋 없음) */
const PROVIDER_MARK: Record<string, string> = { google: 'G', ssafy: 'S' };

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const lostReason = useAuth((s) => s.lostReason);
  const clearLostReason = useAuth((s) => s.clearLostReason);
  const startLogin = useAuth((s) => s.startLogin);
  const location = useLocation();
  const [params] = useSearchParams();
  // BE(access_denied·oauth_failed)와 RequireAuth·콜백(no_session·session_expired·network) 모두 ?error=로 온다
  const message = loginErrorMessage(params.get('error'));
  const from = (location.state as { from?: string } | null)?.from ?? null;

  // 사유는 URL에 이미 실렸으므로 store에서는 지운다 (다음 방문에 다시 붙지 않게)
  useEffect(() => {
    if (lostReason) clearLostReason();
  }, [lostReason, clearLostReason]);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <div className="login">
      <section className="login-brand">
        <div className="login-wordmark">SSAPLASH</div>
        <p className="login-slogan">스틱 하나로 시작하는 나의 첫 드럼</p>
        <div className="login-kit" aria-hidden="true">
          <KitCanvas layout={DEFAULT_KIT_LAYOUT} />
        </div>
      </section>
      <section className="login-card">
        <h1>로그인</h1>
        <p className="dim">소셜 계정으로 로그인하면 세팅·프리셋과 플레이 기록이 계정에 저장됩니다. 이메일·비밀번호 가입은 없습니다.</p>
        {message && <p className={params.get('error') === 'withdrawn' ? 'notice' : 'notice error'}>{message}</p>}
        <div className="col login-buttons">
          {PROVIDERS.map((p, i) => (
            <button key={p.key} className={i === 0 ? 'btn-primary login-btn' : 'login-btn'} onClick={() => startLogin(p.key, from)}>
              <span className="login-mark" aria-hidden="true">
                {PROVIDER_MARK[p.key]}
              </span>
              {p.label}
            </button>
          ))}
        </div>
        <p className="login-caption">계정은 Google 또는 SSAFY 계정으로만 만들 수 있습니다.</p>
      </section>
    </div>
  );
}
