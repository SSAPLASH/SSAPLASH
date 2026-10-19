import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { DebugOverlay } from './DebugOverlay';

const SOURCE_LABEL: Record<string, string> = {
  none: '키보드',
  pointer: '포인터 모의 IMU',
  ble: 'BLE 스틱',
  websocket: 'WebSocket',
};

export function AppShell() {
  const connected = useLive((s) => s.connected);
  const sourceState = useLive((s) => s.sourceState);
  const audioReady = useLive((s) => s.audioReady);
  const sensorKind = useSettings((s) => s.sensorKind);
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
          <NavLink to="/calibration">캘리브레이션</NavLink>
          <NavLink to="/play">리듬 게임</NavLink>
          <NavLink to="/free">자유 연주</NavLink>
        </nav>
        <div className="topbar-right">
          <span className="small dim">
            {SOURCE_LABEL[sensorKind]}
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
        </div>
      </header>
      <Outlet />
      {debug && <DebugOverlay onClose={() => setDebug(false)} />}
    </div>
  );
}
