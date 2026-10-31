import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/authStore';
import { useShellStore } from '@/store/shellStore';
import { DebugOverlay } from './DebugOverlay';
import { GlassDock } from './shell/GlassDock';
import { ProfileMenu } from './shell/ProfileMenu';
import { Sidebar } from './shell/Sidebar';
import { StickStatusIndicator } from './shell/StickStatusIndicator';
import { TopBar } from './shell/TopBar';
import { useSidebarCollapsed } from './shell/useMediaQuery';

/** 개발 모니터 빌드(VITE_MONITOR=true)에서만 "모니터 새 창" 버튼을 둔다. 상수 분기라 미설정 빌드에는 코드가 남지 않는다 */
const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';

interface Props {
  /** 로그인 검사 여부(App.tsx가 VITE_AUTH_REQUIRED로 내려준다). 꺼져 있으면 익명일 때 로그인 링크를 보이지 않는다 */
  authRequired: boolean;
}

/**
 * 앱 셸: 사이드바 + workarea(TopBar + 본문). immersive(전체 화면 연주)면 사이드바·TopBar 없이 본문만 전폭.
 * Dock·StickStatus·아바타는 셸 루트에 fixed로 한 인스턴스만 두어 immersive 전환 때도 언마운트되지 않는다(D3).
 */
export function AppShell({ authRequired }: Props) {
  const immersive = useShellStore((s) => s.immersive);
  const sideCollapsed = useSidebarCollapsed();
  const authStatus = useAuth((s) => s.status);
  const [debug, setDebug] = useState(false);
  const { pathname } = useLocation();
  const inMonitor = pathname.startsWith('/monitor');
  const workareaRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const lastPath = useRef(pathname);
  const pendingFocus = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote' && !(e.target instanceof HTMLInputElement)) setDebug((d) => !d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 경로가 바뀐 뒤: 스크롤 맨 위 + 포커스 이동(D14). 첫 로드·쿼리만 바뀐 경우는 건드리지 않는다.
  // immersive 여부는 페이지의 useShell 효과가 store에 먼저 쓰고 렌더는 한 박자 늦으므로, 렌더 값이 store와 맞을 때까지 기다린다
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      pendingFocus.current = true;
      window.scrollTo(0, 0);
    }
    if (!pendingFocus.current || useShellStore.getState().immersive !== immersive) return;
    pendingFocus.current = false;
    const target = immersive ? routeRef.current : workareaRef.current?.querySelector<HTMLElement>('.topbar-title');
    target?.focus({ preventScroll: true });
  }, [pathname, immersive]);

  return (
    <div className={`shell${immersive ? ' immersive' : ''}`} style={{ '--side-w': immersive ? '0px' : sideCollapsed ? '80px' : '240px' } as CSSProperties}>
      {!immersive && <Sidebar />}
      <div className="workarea" ref={workareaRef}>
        {!immersive && <TopBar />}
        {/* 경로가 바뀌면 key로 다시 마운트되어 .route-fade가 페이드 인한다(쿼리만 바뀌면 그대로). 연주 화면도 같은 래퍼 */}
        <div key={pathname} ref={routeRef} className="route-view route-fade" tabIndex={-1}>
          <Outlet />
        </div>
      </div>

      <div className="shell-dock">
        <GlassDock />
      </div>
      <div className="shell-right">
        {MONITOR_ENABLED && !inMonitor && (
          <button
            className="btn-ghost small"
            onClick={() => window.open('/monitor/stick?follow=1', 'ssaplash-monitor', 'popup,width=1400,height=900')}
          >
            모니터 새 창
          </button>
        )}
        {authRequired && authStatus === 'anonymous' && (
          <NavLink to="/login" className="small">
            로그인
          </NavLink>
        )}
        <StickStatusIndicator />
        <ProfileMenu />
      </div>
      {debug && <DebugOverlay onClose={() => setDebug(false)} />}
    </div>
  );
}
