import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { RECORDING_ENABLED } from '@/config/features';
import { needsRecommendationPrompt } from '@/domain/account/recommendationConsent';
import { recommendationConsentEnabled } from '@/domain/account/signupTerms';
import { metronome } from '@/engine/Metronome';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import { useShellStore } from '@/store/shellStore';
import { RouteErrorBoundary } from '@/components/shell/RouteErrorBoundary';
import { prefetchRoute } from './prefetchRoute';
import { LazyChartAutoplayToggle } from '@/features/play/components/diag/lazyChartAutoplay';
import { RecordingToast } from '@/components/recording/RecordingToast';
import { SaveRecordingDialog } from '@/components/recording/SaveRecordingDialog';
import { GlassDock } from '@/components/shell/dock/GlassDock';
import { ProfileMenu } from '@/components/shell/account/ProfileMenu';
import { Sidebar } from '@/components/shell/nav/Sidebar';
import { LessonInvite } from '@/components/lesson/LessonInvite';
import { StickStatusIndicator } from '@/components/shell/dock/StickStatusIndicator';
import { TopBar } from '@/components/shell/nav/TopBar';
import { useSidebarCollapsed } from '@/components/shell/useMediaQuery';

// 조건부로만 뜨는 셸 UI라 첫 로드에서 뺀다(설계 TECH-route-code-split U2 ①)
const DebugOverlay = lazy(() => import('@/components/shell/DebugOverlay').then((m) => ({ default: m.DebugOverlay })));
const RecommendationConsentDialog = lazy(() =>
  import('@/components/shell/RecommendationConsentDialog').then((m) => ({ default: m.RecommendationConsentDialog })),
);

/**
 * 모니터 빌드(VITE_MONITOR=true)의 개발 서버에서만 "모니터 새 창" 버튼을 둔다. 배포 빌드는 모니터를 켜도 일반 사용자에게
 * 보이지 않게 주소(/monitor/stick?follow=1)로만 연다(설계 PLAY-002 live-play-diagnostics D4). 상수 분기라 그 밖의 빌드에는 코드가 남지 않는다
 */
const MONITOR_ENABLED = import.meta.env.DEV && import.meta.env.VITE_MONITOR === 'true';

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
  const signupCompleted = useAuth((s) => s.user?.signupCompleted);
  const userId = useAuth((s) => s.user?.id);
  const consent = useRecommendationConsent((s) => s.consent);
  const consentDismissed = useRecommendationConsent((s) => s.dismissed);
  const consentSaving = useRecommendationConsent((s) => s.saving);
  const [debug, setDebug] = useState(false);
  const { pathname } = useLocation();
  const inMonitor = pathname.startsWith('/monitor');
  // Dock은 화면이 켠다(useDock). 자유 연습과 게임·악보의 연주 단계에서만 true
  const showDock = useShellStore((s) => s.dock);
  const dockRaised = useShellStore((s) => s.dockRaised);
  // Dock이 없는 화면으로 나가면 Dock에서 켠 메트로놈을 멈춘다 — 끌 수 있는 조작이 사라지기 때문이다.
  // 곡 연주에 묶인(locked) 클릭은 연주 화면이 정리한다
  useEffect(() => {
    if (showDock) return;
    const met = useLive.getState().metronome;
    if (met.playing && !met.locked) metronome.stop();
  }, [showDock]);
  const workareaRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const lastPath = useRef(pathname);
  const lastImmersive = useRef(immersive);
  const pendingFocus = useRef(false);

  // 맞춤 곡 추천 학습 동의 상태(설계 COACH-004 D6): 로그인 복원 뒤 한 번 읽는다(store가 세션당 1회).
  // 가입 전 회원은 GET이 403 SIGNUP_INCOMPLETE라 읽지 않는다. 로그아웃하면 이전 계정의 상태를 버린다. 인증 끔(authenticated 아님)에서는 아무것도 하지 않는다
  // 마지막으로 읽은 계정. 로그아웃을 거치지 않고 계정이 바뀌면 이전 상태를 버리고 다시 읽는다(StrictMode 이중 실행에서는 같은 계정이라 한 번만 읽는다)
  const consentUserRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const st = useRecommendationConsent.getState();
    if (authStatus === 'authenticated' && signupCompleted !== false) {
      if (consentUserRef.current !== undefined && consentUserRef.current !== userId) st.reset();
      consentUserRef.current = userId;
      void st.load();
    } else if (authStatus === 'anonymous') {
      consentUserRef.current = undefined;
      st.reset();
    }
  }, [authStatus, signupCompleted, userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote' && !(e.target instanceof HTMLInputElement)) setDebug((d) => !d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 경로가 바뀐 뒤: 스크롤 맨 위 + 포커스 이동(D14). 첫 로드·쿼리만 바뀐 경우는 건드리지 않는다.
  // 같은 경로 안에서 전체 화면으로 들어가거나 나올 때(/play 준비 → 연주)도 포커스를 옮긴다(UX-24)
  // immersive 여부는 페이지의 useShell 효과가 store에 먼저 쓰고 렌더는 한 박자 늦으므로, 렌더 값이 store와 맞을 때까지 기다린다
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      pendingFocus.current = true;
      window.scrollTo(0, 0);
    }
    if (lastImmersive.current !== immersive) {
      lastImmersive.current = immersive;
      pendingFocus.current = true;
    }
    if (!pendingFocus.current || useShellStore.getState().immersive !== immersive) return;
    pendingFocus.current = false;
    // immersive(전체 화면 연주)는 화면 안의 [data-focus-title](연주 HUD 제목)로, 없으면 본문 래퍼로 옮긴다
    const target = immersive
      ? (routeRef.current?.querySelector<HTMLElement>('[data-focus-title]') ?? routeRef.current)
      : workareaRef.current?.querySelector<HTMLElement>('.topbar-title');
    target?.focus({ preventScroll: true });
  }, [pathname, immersive]);

  // 한 번도 답하지 않은 기존 사용자에게만 1회 안내. 가입 화면·연주 중에는 띄우지 않고 벗어난 뒤 다음 렌더에 띄운다.
  // PUT이 실패하면 이번 세션만 다시 띄우지 않는다
  const showConsentDialog =
    recommendationConsentEnabled() && authStatus === 'authenticated' && signupCompleted !== false && !immersive && pathname !== '/signup' && !consentDismissed && needsRecommendationPrompt(consent);
  const answerConsent = (agreed: boolean) => {
    useRecommendationConsent
      .getState()
      .set(agreed)
      .catch(() => useRecommendationConsent.getState().dismissForSession());
  };

  return (
    <div className={`shell${immersive ? ' immersive' : ''}`} style={{ '--side-w': immersive ? '0px' : sideCollapsed ? '80px' : '240px' } as CSSProperties}>
      {!immersive && <Sidebar onPrefetch={prefetchRoute} />}
      <div className="workarea" ref={workareaRef}>
        {!immersive && <TopBar />}
        {!immersive && <LessonInvite />}
        {/* 경로가 바뀌면 key로 다시 마운트되어 .route-fade가 페이드 인한다(쿼리만 바뀌면 그대로). 연주 화면도 같은 래퍼 */}
        {/* Suspense는 key 래퍼 바깥에 둔다. 안에 두면 key가 바뀔 때마다 새 경계가 생겨 지연 화면을 기다리는 동안 이전 화면이 아닌 fallback이 보인다 */}
        {/* 오류 경계는 Suspense·key 래퍼보다 바깥(설계 TECH-chunk-load-recovery R3). 경로가 바뀌면 오류가 풀린다 */}
        <RouteErrorBoundary resetKey={pathname}>
          <Suspense fallback={null}>
            <div key={pathname} ref={routeRef} className="route-view route-fade" tabIndex={-1}>
              <Outlet />
            </div>
          </Suspense>
        </RouteErrorBoundary>
      </div>

      {showDock && (
        <div className={`shell-dock${dockRaised ? ' raised' : ''}`}>
          <GlassDock />
        </div>
      )}
      {RECORDING_ENABLED && (
        <>
          <SaveRecordingDialog />
          <RecordingToast />
        </>
      )}
      <div className="shell-right">
        {MONITOR_ENABLED && !inMonitor && (
          <button
            className="btn-ghost small"
            onClick={() => window.open('/monitor/stick?follow=1', 'ssaplash-monitor', 'popup,width=1400,height=900')}
          >
            모니터 새 창
          </button>
        )}
        {/* 채보 확인 재생 토글(T2). 진단 빌드에서만 존재한다 */}
        {LazyChartAutoplayToggle && !inMonitor && (
          <Suspense fallback={null}>
            <LazyChartAutoplayToggle />
          </Suspense>
        )}
        {authRequired && authStatus === 'anonymous' && (
          <NavLink to="/login" className="small">
            로그인
          </NavLink>
        )}
        <StickStatusIndicator />
        <ProfileMenu />
      </div>
      {showConsentDialog && (
        <Suspense fallback={null}>
          <RecommendationConsentDialog busy={consentSaving} onAgree={() => answerConsent(true)} onDecline={() => answerConsent(false)} />
        </Suspense>
      )}
      {debug && (
        <Suspense fallback={null}>
          <DebugOverlay onClose={() => setDebug(false)} />
        </Suspense>
      )}
    </div>
  );
}
