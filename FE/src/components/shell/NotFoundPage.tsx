// 모르는 주소(404) 화면. 셸 안·로그인 확인 아래에서 그린다(설계 TECH-364 D1~D3). 지연 로드하지 않는다.
import { Link } from 'react-router-dom';
import { useShell } from './nav/useShell';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import { EmptyState } from '@/components/ui/feedback/EmptyState';

const TITLE = '페이지를 찾을 수 없어요';

export function NotFoundPage() {
  useShell({ title: TITLE });
  return (
    <main className="main">
      <EmptyState
        headingLevel={2}
        title={TITLE}
        description="주소가 바뀌었거나 없는 페이지예요."
        action={
          <Link to="/free" className={buttonClassName({ variant: 'primary', size: 'md' })}>
            자유 연습으로
          </Link>
        }
      />
    </main>
  );
}
