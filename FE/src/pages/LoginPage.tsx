// 로그인 화면 (설계 3-7). 버튼은 BE 로그인 시작 주소로 브라우저를 통째로 보낸다(fetch 아님) — BE가 제공자 동의 화면으로 302.
// 기존 클래스만 쓴다. 정식 디자인은 별도 작업.
import { useEffect } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/store/authStore';
import { LOGIN_PROVIDERS, loginErrorMessage } from '@/domain/auth';

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
    <main className="main">
      <section className="hero">
        <h1>로그인</h1>
        <p>소셜 계정으로 로그인하면 세팅·프리셋과 플레이 기록이 계정에 저장됩니다. 이메일·비밀번호 가입은 없습니다.</p>
      </section>
      <section className="card" style={{ maxWidth: 420 }}>
        {message && (
          <p className="notice error" style={{ marginBottom: 14 }}>
            {message}
          </p>
        )}
        <div className="col" style={{ gap: 10 }}>
          {LOGIN_PROVIDERS.map((p, i) => (
            <button key={p.key} className={i === 0 ? 'btn-primary btn-lg' : 'btn-lg'} onClick={() => startLogin(p.key, from)}>
              {p.label}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
