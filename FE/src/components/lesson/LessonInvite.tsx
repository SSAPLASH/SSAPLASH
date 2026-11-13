// 입문 코스 권유 카드 (Jira 331, 설계 SETUP-입문-코스 4-5). 통과한 레슨이 없는 사용자에게 화면 위에 한 번 보인다.
// 닫으면 이 브라우저에서는 다시 보이지 않는다. 로그인 없는 빌드·내장 곡 빌드에서는 그리지 않는다.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AUTH_REQUIRED } from '@/config/auth';
import { LESSONS_PATH, shouldInvite } from '@/domain/play/lesson';
import { useAuth } from '@/store/authStore';
import { useLessons } from '@/store/lessonStore';
import { SONGS_SOURCE } from '@/store/songStore';
import { Button } from '@/components/ui/action/Button';
import './lesson.css';

const ENABLED = AUTH_REQUIRED && SONGS_SOURCE === 'api';

export function LessonInvite() {
  const authed = useAuth((a) => a.status === 'authenticated');
  const list = useLessons((s) => s.list);
  const localPassed = useLessons((s) => s.localPassed);
  const dismissed = useLessons((s) => s.inviteDismissed);
  const load = useLessons((s) => s.load);
  const dismiss = useLessons((s) => s.dismissInvite);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const onLessonsTab = pathname === '/sheet' && new URLSearchParams(search).get('tab') === 'lessons';

  useEffect(() => {
    if (ENABLED && authed && !dismissed) void load();
  }, [authed, dismissed, load]);

  if (!ENABLED || !shouldInvite({ authed, lessons: list?.items ?? null, localPassed, dismissed, onLessonsTab })) return null;
  return (
    <div className="main lesson-invite-wrap">
      <div className="lesson-invite" role="region" aria-label="입문 코스 안내">
        <div className="lesson-invite-text">
          <strong>드럼이 처음이신가요?</strong>
          <span>입문 코스에서 음표 읽기부터 8비트까지 차근차근 배워 보세요. 스테이지 하나에 1분이면 됩니다.</span>
        </div>
        <div className="lesson-invite-actions">
          <Button onClick={() => navigate(LESSONS_PATH)}>입문 코스 시작</Button>
          <Button variant="secondary" onClick={dismiss}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}
