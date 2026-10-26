import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { useAuth } from '@/store/authStore';
import { sensorRegistry } from '@/app/sensorRegistry';
import { DebugOverlay } from './DebugOverlay';
import { Metronome } from './shell/Metronome';
import { ProfileMenu } from './shell/ProfileMenu';
import { SoundToggle } from './shell/SoundToggle';

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
  const [debug, setDebug] = useState(false);

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
          <NavLink to="/play">리듬 게임</NavLink>
          <NavLink to="/sheet">악보 연습</NavLink>
          <NavLink to="/free">자유 연주</NavLink>
        </nav>
        <Metronome />
        <div className="topbar-right">
          <SoundToggle />
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
          <ProfileMenu />
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
