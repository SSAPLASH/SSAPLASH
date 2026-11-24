// 좌측 사이드바(Figma Navigation / Sidebar 126:2122). 펼침 240 · 접힘 80(아이콘만 + title 툴팁). 하단은 설정만 두고 로그아웃은 프로필 메뉴에 있다(UX-22).
// 실제 접힘 = settingsStore.sidebarCollapsed || 태블릿(≤1024). 접기/펼치기는 헤더(로고 옆)에 두고 태블릿에서는 숨긴다. 메뉴는 그룹 없이 평평하다(UX-19).
// 예외 하나: 「악보 연습」에 들어와 있고 펼쳐져 있으면 그 아래에 곡 범위 하위 메뉴(기본 곡·내 곡·AI 추천곡·학습 코스)를 보인다
// (설계 MODE-003-악보-연습-하위-메뉴). 범위는 주소 값이 기준이라 곡 고르기와 서로를 모른 채 같은 값을 본다. 접힘·태블릿에서는 화면 위 탭이 대신한다.
// 「리듬 게임」에도 같은 조건으로 하위 메뉴(기본 곡·내 곡·AI 추천곡 + 미니게임)를 보인다(설계 MODE-006-minigame-speed D1).
import { useEffect, useRef, type ReactNode } from 'react';
import { m } from 'motion/react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { isAdmin } from '@/domain/account/auth';
import { isMiniPath, MINI_PATH } from '@/domain/play/miniGame';
import {
  isPlayPath,
  isSheetPath,
  PLAY_PATH,
  resolveSheetCategory,
  SHEET_CATEGORY_LABEL,
  SHEET_PATH,
  sheetCategoryAt,
  sheetCategoryOf,
  sheetCategorySearch,
  visiblePlayCategories,
  visibleSheetCategories,
} from '@/domain/song/sheetCategory';
import { AUTH_REQUIRED } from '@/config/auth';
import { PREFETCH_HOVER_MS } from '@/config/prefetch';
import { useAuth } from '@/store/authStore';
import { useChartJob } from '@/store/chartJobStore';
import { useSettings } from '@/store/settingsStore';
import { useSongs } from '@/store/songStore';
import { SidebarToggleIcon } from './SidebarToggleIcon';
import { TABLET_QUERY, useMediaQuery, useSidebarCollapsed } from '@/components/shell/useMediaQuery';

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

/** 현재 위치 표시 이동. 200ms ease-out(tokens.css --motion-base·--ease-out과 같은 값) */
const ACTIVE_MARK_TRANSITION = { duration: 0.2, ease: [0, 0, 0.58, 1] } as const;

/** onPrefetch: 메뉴에 hover(PREFETCH_HOVER_MS)·포커스가 오면 그 경로를 미리 받는 함수. 경로별 모듈은 app이 알고 있으므로 조립하는 쪽(AppShell)이 넘겨준다 */
export function Sidebar({ onPrefetch }: { onPrefetch?: (to: string) => void } = {}) {
  const stored = useSettings((s) => s.sidebarCollapsed);
  const setStored = useSettings((s) => s.setSidebarCollapsed);
  const tablet = useMediaQuery(TABLET_QUERY);
  const collapsed = useSidebarCollapsed();
  // 채보 변환 작업이 진행 중일 때 라이브러리에 점을 단다
  const libraryBadge = useChartJob((s) => s.active !== null && s.phase !== 'done' && s.phase !== 'failed');
  const admin = useAuth((s) => isAdmin(s.user));
  // 악보 연습 하위 메뉴: 펼쳐져 있고 악보 연습 안일 때만. 보일 범위·지금 범위는 곡 고르기와 같은 규칙(domain/song/sheetCategory)으로 정한다
  const { pathname, search } = useLocation();
  const authed = useAuth((s) => s.status === 'authenticated');
  const songSource = useSongs((s) => s.source);
  const sheetCategories =
    !collapsed && isSheetPath(pathname)
      ? visibleSheetCategories({ source: songSource, authed, authRequired: AUTH_REQUIRED })
      : [];
  const sheetCurrent = resolveSheetCategory(sheetCategoryAt(pathname, search), sheetCategories);
  // 리듬 게임 하위 메뉴: 범위 항목 뒤에 「미니게임」이 항상 붙는다(내장 곡 출처라 범위가 비어도 진입점은 남긴다).
  // 미니게임 경로에서는 「미니게임」만 현재 표시이고, 그 밖에는 주소의 범위 하나만 표시한다
  const playOpen = !collapsed && isPlayPath(pathname);
  const playCategories = playOpen ? visiblePlayCategories({ source: songSource, authed, authRequired: AUTH_REQUIRED }) : [];
  const inMini = isMiniPath(pathname);
  const playParams = new URLSearchParams(search);
  const playCurrent = resolveSheetCategory(sheetCategoryOf({ tab: playParams.get('tab'), scope: playParams.get('scope') }), playCategories);

  // 메뉴에 커서가 100ms 머물거나 키보드 포커스가 오면 그 화면을 미리 받는다(설계 TECH-351)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHover = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => cancelHover, []);
  const prefetchProps = (to: string) => ({
    onMouseEnter: () => {
      cancelHover();
      hoverTimer.current = setTimeout(() => onPrefetch?.(to), PREFETCH_HOVER_MS);
    },
    onMouseLeave: cancelHover,
    onFocus: () => onPrefetch?.(to),
  });

  const item = (mi: MenuItem) => (
    <NavLink key={mi.to} to={mi.to} className="side-item" title={collapsed ? mi.label : undefined} aria-label={mi.label} {...prefetchProps(mi.to)}>
      {({ isActive }) => (
        <>
          {/* 현재 위치 표시. 활성 항목에만 있고 layoutId로 이전 항목에서 새 항목으로 미끄러진다.
              LazyMotion 기능이 오기 전에는 일반 span으로 제자리에 그려진다(애니메이션만 없음). 모션 줄이기는 MotionConfig가 처리 */}
          {isActive && <m.span className="side-active-mark" layoutId="side-active" transition={ACTIVE_MARK_TRANSITION} aria-hidden="true" />}
          {mi.icon}
          {/* 라벨은 항상 그리고 접힘 때 opacity로 숨긴다(폭 전환과 시점을 맞추려고, CSS .side-label) */}
          <span className="side-label" aria-hidden={collapsed}>
            {mi.label}
          </span>
          {mi.badge && <span className="side-badge" aria-label="처리 중" />}
        </>
      )}
    </NavLink>
  );

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="주 메뉴">
      {/* 헤더: 로고 + 접기/펼치기(UX-19, 2026-10-30). 태블릿은 강제 접힘이라 버튼을 숨긴다 */}
      <div className="side-header">
        {/* 펼친 사이드바에는 워드마크 이미지를 표시한다(public/images/ssaplash-wordmark.webp, 744×96). */}
        {!collapsed && (
          <span className="side-wordmark">
            <img src="/images/ssaplash-wordmark.webp" alt="SSAPLASH" width={744} height={96} draggable={false} />
          </span>
        )}
        {!tablet && (
          <button
            type="button"
            className="side-toggle"
            title={collapsed ? '펼치기' : '접기'}
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            aria-expanded={!collapsed}
            onClick={() => setStored(!stored)}
          >
            <SidebarToggleIcon collapsed={collapsed} />
          </button>
        )}
      </div>

      <nav className="side-menu">
        {item({ to: '/free', label: '자유 연습', icon: ICONS.free })}
        {item({ to: PLAY_PATH, label: '리듬 게임', icon: ICONS.rhythm })}
        {playOpen && (
          <ul className="side-sub" aria-label="리듬 게임 메뉴">
            {playCategories.map((category) => (
              <li key={category}>
                {/* 곡 고르기 안에서 범위만 바꿀 때는 방문 기록을 쌓지 않는다(악보 연습과 같은 규칙) */}
                <Link
                  to={{ pathname: PLAY_PATH, search: sheetCategorySearch(category) }}
                  replace={pathname === PLAY_PATH}
                  className="side-sub-item"
                  aria-current={!inMini && category === playCurrent ? 'page' : undefined}
                >
                  {SHEET_CATEGORY_LABEL[category]}
                </Link>
              </li>
            ))}
            <li>
              <Link to={MINI_PATH} className="side-sub-item" aria-current={inMini ? 'page' : undefined} {...prefetchProps(MINI_PATH)}>
                미니게임
              </Link>
            </li>
          </ul>
        )}
        {item({ to: SHEET_PATH, label: '악보 연습', icon: ICONS.sheet })}
        {sheetCategories.length > 0 && (
          <ul className="side-sub" aria-label="악보 연습 범위">
            {sheetCategories.map((category) => (
              <li key={category}>
                {/* 곡 고르기 안에서 범위만 바꿀 때는 방문 기록을 쌓지 않는다(화면 위 탭과 같은 규칙) */}
                <Link
                  to={{ pathname: SHEET_PATH, search: sheetCategorySearch(category) }}
                  replace={pathname === SHEET_PATH}
                  className="side-sub-item"
                  aria-current={category === sheetCurrent ? 'page' : undefined}
                >
                  {SHEET_CATEGORY_LABEL[category]}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {item({ to: '/studio', label: '라이브러리', icon: ICONS.library, badge: libraryBadge })}
        {item({ to: '/history', label: '연주 기록', icon: ICONS.history })}
        {item({ to: '/setup', label: '드럼 세팅', icon: ICONS.setup })}
        {/* 관리자에게만 보인다. 권한 판단은 BE가 한다(Jira 262) */}
        {admin && item({ to: '/admin/songs', label: '공용 곡 관리', icon: ICONS.admin })}
      </nav>

      <div className="side-footer">
        <NavLink to="/settings" className="side-foot-btn" title={collapsed ? '설정' : undefined} aria-label="설정" {...prefetchProps('/settings')}>
          {ICONS.settings}
          <span className="side-label" aria-hidden={collapsed}>
            설정
          </span>
        </NavLink>
      </div>
    </aside>
  );
}
