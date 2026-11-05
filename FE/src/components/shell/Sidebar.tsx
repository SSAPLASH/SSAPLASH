// 좌측 사이드바(Figma Navigation / Sidebar 126:2122). 펼침 240 · 접힘 80(아이콘만 + title 툴팁). 하단은 설정만 두고 로그아웃은 프로필 메뉴에 있다(UX-22).
// 실제 접힘 = settingsStore.sidebarCollapsed || 태블릿(≤1024). 접기/펼치기는 헤더(로고 옆)에 두고 태블릿에서는 숨긴다. 메뉴는 그룹 없이 평평하다(UX-19).
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { isAdmin } from '@/domain/auth';
import { useAuth } from '@/store/authStore';
import { useChartJob } from '@/store/chartJobStore';
import { useSettings } from '@/store/settingsStore';
import { SidebarToggleIcon } from './SidebarToggleIcon';
import { TABLET_QUERY, useMediaQuery, useSidebarCollapsed } from './useMediaQuery';

/** 선 아이콘 공통 틀(20px, 현재 글자색) */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="side-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS = {
  free: (
    <Icon>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </Icon>
  ),
  rhythm: (
    <Icon>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </Icon>
  ),
  sheet: (
    <Icon>
      <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </Icon>
  ),
  library: (
    <Icon>
      <path d="M4 4v16M9 4v16" />
      <path d="M14 5l5 1-3 14-5-1z" />
    </Icon>
  ),
  history: (
    <Icon>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 8v4l3 2" />
    </Icon>
  ),
  setup: (
    <Icon>
      <ellipse cx="12" cy="8" rx="8" ry="3" />
      <path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8" />
    </Icon>
  ),
  admin: (
    <Icon>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Icon>
  ),
  settings: (
    <Icon>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
};

interface MenuItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** 점 배지(처리 중인 작업 알림) */
  badge?: boolean;
}

export function Sidebar() {
  const stored = useSettings((s) => s.sidebarCollapsed);
  const setStored = useSettings((s) => s.setSidebarCollapsed);
  const tablet = useMediaQuery(TABLET_QUERY);
  const collapsed = useSidebarCollapsed();
  // 채보 변환 작업이 진행 중일 때 라이브러리에 점을 단다
  const libraryBadge = useChartJob((s) => s.active !== null && s.phase !== 'done' && s.phase !== 'failed');
  const admin = useAuth((s) => isAdmin(s.user));

  const item = (m: MenuItem) => (
    <NavLink key={m.to} to={m.to} className="side-item" title={collapsed ? m.label : undefined} aria-label={m.label}>
      {m.icon}
      {/* 라벨은 항상 그리고 접힘 때 opacity로 숨긴다(폭 전환과 시점을 맞추려고, CSS .side-label) */}
      <span className="side-label" aria-hidden={collapsed}>
        {m.label}
      </span>
      {m.badge && <span className="side-badge" aria-label="처리 중" />}
    </NavLink>
  );

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="주 메뉴">
      {/* 헤더: 로고 + 접기/펼치기(UX-19, 2026-10-30). 태블릿은 강제 접힘이라 버튼을 숨긴다 */}
      <div className="side-header">
        {/* 로고는 링크가 아니다(Figma). 접기 버튼 옆에서 잘못 눌려 이동하는 것을 막는다 */}
        {/* 두 글자를 겹쳐 두고 접힘 때 교차 페이드한다(CSS .side-logo-full/.side-logo-short) */}
        <span className="side-logo" aria-label="SSAPLASH">
          <span className="side-logo-full" aria-hidden="true">
            SSAPLASH
          </span>
          <span className="side-logo-short" aria-hidden="true">
            S
          </span>
        </span>
        {!tablet && (
          <button
            type="button"
            className="side-toggle"
            title={collapsed ? '펼치기' : '접기'}
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            onClick={() => setStored(!stored)}
          >
            <SidebarToggleIcon collapsed={collapsed} />
          </button>
        )}
      </div>

      <nav className="side-menu">
        {item({ to: '/free', label: '자유 연습', icon: ICONS.free })}
        {item({ to: '/play', label: '리듬 게임', icon: ICONS.rhythm })}
        {item({ to: '/sheet', label: '악보 연습', icon: ICONS.sheet })}
        {item({ to: '/studio', label: '라이브러리', icon: ICONS.library, badge: libraryBadge })}
        {item({ to: '/history', label: '연주 기록', icon: ICONS.history })}
        {item({ to: '/setup', label: '드럼 세팅', icon: ICONS.setup })}
        {/* 관리자에게만 보인다. 권한 판단은 BE가 한다(Jira 262) */}
        {admin && item({ to: '/admin/songs', label: '공용 곡 관리', icon: ICONS.admin })}
      </nav>

      <div className="side-footer">
        <NavLink to="/settings" className="side-foot-btn" title={collapsed ? '설정' : undefined} aria-label="설정">
          {ICONS.settings}
          <span className="side-label" aria-hidden={collapsed}>
            설정
          </span>
        </NavLink>
      </div>
    </aside>
  );
}
