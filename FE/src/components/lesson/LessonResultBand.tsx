// 결과 화면의 입문 코스 띠 (Jira 331, 설계 SETUP-입문-코스 4-4). 이 기록의 채보가 레슨이면 통과·재도전 안내와 다음 동작을 보인다.
// 통과는 서버와 같은 정확도 계산으로 바로 판정하고, 업로드를 기다리지 않고 이번 접속의 진도에 더한다.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LESSONS_PATH, lessonOfChart, lessonPath, nextLesson, playPassed } from '@/domain/lesson';
import type { PlayLog } from '@/engine/playLog';
import { useAuth } from '@/store/authStore';
import { useLessons } from '@/store/lessonStore';
import { Button } from '@/components/ui/Button';
import './lesson.css';

export function LessonResultBand({ log }: { log: PlayLog }) {
  const authed = useAuth((a) => a.status === 'authenticated');
  const list = useLessons((s) => s.list);
  const load = useLessons((s) => s.load);
  const markPassed = useLessons((s) => s.markPassed);
  const navigate = useNavigate();
  const sheet = log.mode === 'SHEET' && log.chartId != null;

  useEffect(() => {
    if (authed && sheet) void load();
  }, [authed, sheet, load]);

  const lessons = list?.items ?? [];
  const lesson = sheet ? lessonOfChart(lessons, log.chartId) : undefined;
  const passed = lesson !== undefined && list !== null && playPassed({ score: log.summary.score, noteCount: log.sourceNoteCount ?? log.notes.length }, list.passAccuracy);

  useEffect(() => {
    if (lesson && passed) markPassed(lesson.songId);
  }, [lesson, passed, markPassed]);

  if (!lesson || !list) return null;
  const next = nextLesson(lessons, lesson.songId);
  return (
    <div className={`lesson-band${passed ? ' is-pass' : ''}`} role="status">
      <div className="lesson-band-text">
        <b>{passed ? '통과!' : '조금만 더!'}</b>
        <small>
          {passed ? (next ? '다음 스테이지가 열렸어요.' : '입문 코스를 모두 마쳤어요.') : `정확도 ${list.passAccuracy}%를 넘기면 통과예요.`}
        </small>
      </div>
      <div className="lesson-band-actions">
        {passed && next && <Button onClick={() => navigate(lessonPath(next))}>다음 레슨</Button>}
        {!passed && <Button onClick={() => navigate(lessonPath(lesson))}>다시 하기</Button>}
        <Button variant={passed && !next ? 'primary' : 'secondary'} onClick={() => navigate(LESSONS_PATH)}>
          코스로
        </Button>
      </div>
    </div>
  );
}
