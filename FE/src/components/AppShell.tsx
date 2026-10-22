import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { useAuth } from '@/store/authStore';
import { sensorRegistry } from '@/app/sensorRegistry';
import { DebugOverlay } from './DebugOverlay';

interface Props {
  /** 로그인 검사 여부(App.tsx가 VITE_AUTH_REQUIRED로 내려준다). 꺼져 있으면 익명일 때 로그인 링크를 보이지 않는다 */
  authRequired: boolean;
}

export function AppShell({ authRequired }: Props) {
  const connected = useLive((s) => s.connected);
  const sourceState = useLive((s) => s.sourceState);
  const audioReady = useLive((s) => s.audioReady);
  const sensorKind = useSettings((s) => s.sensorKind);
  const authStatus = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const [debug, setDebug] = useState(false);

  const onLogout = () => {
    void logout().then(() => navigate('/login', { replace: true }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote' && !(e.target instanceof HTMLInputElement)) setDebug((d) => !d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          SSAPLASH
        </NavLink>
        <nav className="nav">
          <NavLink to="/setup">세팅</NavLink>
          <NavLink to="/calibration">캘리브레이션</NavLink>
          <NavLink to="/play">리듬 게임</NavLink>
          <NavLink to="/sheet">악보 연습</NavLink>
          <NavLink to="/free">자유 연주</NavLink>
        </nav>
        <div className="topbar-right">
          <span className="small dim">
            {sensorKind === 'none' ? '키보드' : (sensorRegistry.get(sensorKind)?.label ?? sensorKind)}
            {sensorKind !== 'none' && ' + 키보드'}
            {sourceState === 'connecting' && ' · 연결 중'}
            {sourceState === 'error' && ' · 오류'}
          </span>
          <div className="sticks" aria-label="스틱 연결 상태">
            <span className={`stick ${connected[0] ? 'on' : ''}`}>
              <span className="dot" />왼손
            </span>
            <span className={`stick ${connected[1] ? 'on' : ''}`}>
              <span className="dot" />오른손
            </span>
          </div>
          {!audioReady && <span className="small faint">클릭하면 소리가 켜집니다</span>}
          {authStatus === 'authenticated' && user && (
            <span className="row" style={{ gap: 8 }} aria-label="로그인 사용자">
              {user.profileImageUrl && (
                <img
                  src={user.profileImageUrl}
                  alt=""
                  width={24}
                  height={24}
                  style={{ borderRadius: '50%' }}
                  referrerPolicy="no-referrer"
                />
              )}
              <span className="small dim">{user.nickname}</span>
              <button className="btn-ghost small" onClick={onLogout}>
                로그아웃
              </button>
            </span>
          )}
          {authRequired && authStatus === 'anonymous' && (
            <NavLink to="/login" className="small">
              로그인
            </NavLink>
          )}
        </div>
      </header>
      <Outlet />
      {debug && <DebugOverlay onClose={() => setDebug(false)} />}
    </div>
  );
}
