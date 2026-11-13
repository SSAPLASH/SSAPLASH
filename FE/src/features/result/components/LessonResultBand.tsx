// 결과 화면의 학습 코스 띠 (Jira 331, 설계 SETUP-입문-코스 4-4, SETUP-학습-코스-중급 4-3). 이 기록의 채보가 레슨이면 통과·재도전 안내와 다음 동작을 보인다.
// 통과는 서버와 같은 정확도 계산으로 바로 판정하고, 업로드를 기다리지 않고 이번 접속의 진도에 더한다.
// 코스의 마지막 레슨을 통과하면 다음 레슨 대신 다음 코스(새 스테이지 맵)로 안내한다.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { courseFinishText, courseMeta, coursePath, lessonOfChart, lessonPath, nextLesson, playPassed } from '@/domain/play/lesson';
import type { PlayLog } from '@/domain/play/playLog';
import { useAuth } from '@/store/authStore';
import { useLessons } from '@/store/lessonStore';
import { Button } from '@/components/ui/action/Button';
import '@/components/lesson/lesson.css';

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
  // 다음 레슨이 같은 코스면 [다음 레슨], 다른 코스면 그 코스로
  const sameCourse = next !== null && next.course === lesson.course;
  const nextCourse = next !== null && !sameCourse ? next.course : null;
  return (
    <div className={`lesson-band${passed ? ' is-pass' : ''}`} role="status">
      <div className="lesson-band-text">
        <b>{passed ? '통과!' : '조금만 더!'}</b>
        <small>{passed ? courseFinishText(lesson, next) : `정확도 ${list.passAccuracy}%를 넘기면 통과예요.`}</small>
      </div>
      <div className="lesson-band-actions">
        {passed && sameCourse && next && <Button onClick={() => navigate(lessonPath(next))}>다음 레슨</Button>}
        {!passed && <Button onClick={() => navigate(lessonPath(lesson))}>다시 하기</Button>}
        {passed && nextCourse ? (
          <Button onClick={() => navigate(coursePath(nextCourse))}>{`${courseMeta(nextCourse).name}로`}</Button>
        ) : (
          <Button variant={passed && !next ? 'primary' : 'secondary'} onClick={() => navigate(coursePath(lesson.course))}>
            코스로
          </Button>
        )}
      </div>
    </div>
  );
}
