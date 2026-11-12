// 공개 화면(로그인·콜백) 공용 전체 화면 틀. 셸(nav·메트로놈·연결 상태) 없이 Outlet만 가운데에 둔다.
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { RouteErrorBoundary } from './RouteErrorBoundary';

export function PublicLayout() {
  const { pathname } = useLocation();
  return (
    <div className="public">
      <div className="public-body">
        <RouteErrorBoundary resetKey={pathname}>
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </div>
      <small className="faint public-caption">SSAPLASH · SSAFY 15기 자율 프로젝트</small>
    </div>
  );
}
