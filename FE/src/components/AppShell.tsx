import { NavLink, Outlet } from 'react-router-dom';

export function AppShell() {
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
      </header>
      <Outlet />
    </div>
  );
}
