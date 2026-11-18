// 결과 화면의 학습 코스 띠 (Jira 331, 설계 SETUP-입문-코스 4-4, SETUP-학습-코스-중급 4-3). 이 기록의 채보가 레슨이면 통과·재도전 안내와 다음 동작을 보인다.
// 통과는 서버와 같은 정확도 계산으로 바로 판정하고, 업로드를 기다리지 않고 이번 접속의 진도에 더한다.
// 코스의 마지막 레슨을 통과하면 다음 레슨 대신 다음 코스(새 스테이지 맵)로 안내한다.
// 방금 친 결과(fresh)에서 통과했고 다음 레슨이 같은 코스면 3초 카운트다운 뒤 다음 레슨으로 넘긴다(설계 SETUP-학습-코스-자동-넘김 4-1).
// 다시 하기는 띠에 두지 않는다 — 결과 화면 아래 [다시 하기](Enter)가 레슨이면 학습 코스 주소로 간다(ResultPage).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  autoAdvanceTarget,
  autoAdvanceText,
  courseFinishText,
  courseMeta,
  coursePath,
  lessonOfChart,
  lessonPath,
  nextLesson,
  playPassed,
} from '@/domain/play/lesson';
import type { PlayLog } from '@/domain/play/playLog';
import { useAuth } from '@/store/authStore';
import { useLessons } from '@/store/lessonStore';
import { Button } from '@/components/ui/action/Button';
import { useAutoAdvance } from '@/components/lesson/useAutoAdvance';
import '@/components/lesson/lesson.css';

/** 카운트다운을 이미 보인 결과(playId). 뒤로 가기로 같은 결과 화면에 돌아왔을 때 다시 세지 않는다 */
const counted = new Set<string>();

interface Props {
  log: PlayLog;
  /** 방금 친 결과인가. 연주 기록에서 지난 결과를 다시 연 경우는 자동으로 넘기지 않는다 */
  fresh?: boolean;
}

export function LessonResultBand({ log, fresh = false }: Props) {
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

  const next = lesson ? nextLesson(lessons, lesson.songId) : null;
  const target = lesson ? autoAdvanceTarget(lesson, next, passed) : null;
  // 이 화면이 처음 뜰 때 이미 센 결과였는가
  const [countedBefore] = useState(() => counted.has(log.playId));
  const canAuto = fresh && target !== null && !countedBefore;
  useEffect(() => {
    if (canAuto) counted.add(log.playId);
  }, [canAuto, log.playId]);
  const auto = useAutoAdvance({
    enabled: canAuto,
    onGo: () => {
      if (target) navigate(lessonPath(target, { auto: true }));
    },
  });

  if (!lesson || !list) return null;
  // 다음 레슨이 같은 코스면 [다음 레슨], 다른 코스면 그 코스로
  const sameCourse = next !== null && next.course === lesson.course;
  const nextCourse = next !== null && !sameCourse ? next.course : null;
  return (
    <div className={`lesson-band${passed ? ' is-pass' : ''}`} role="status">
      <div className="lesson-band-text">
        <b>{passed ? '통과!' : '조금만 더!'}</b>
        <small>{passed ? courseFinishText(lesson, next) : `정확도 ${list.passAccuracy}%를 넘기면 통과예요.`}</small>
      </div>
      {auto.remaining !== null ? (
        <div className="lesson-band-actions">
          <span className="lesson-auto-text" aria-live="polite">
            {autoAdvanceText(auto.remaining)}
          </span>
          <Button variant="secondary" onClick={auto.stop}>
            머무르기
          </Button>
          <Button data-auto-go onClick={auto.goNow}>
            지금 가기
          </Button>
        </div>
      ) : (
      <div className="lesson-band-actions">
        {passed && sameCourse && next && <Button onClick={() => navigate(lessonPath(next))}>다음 레슨</Button>}
        {passed && nextCourse ? (
          <Button onClick={() => navigate(coursePath(nextCourse))}>{`${courseMeta(nextCourse).name}로`}</Button>
        ) : (
          <Button variant={passed && !next ? 'primary' : 'secondary'} onClick={() => navigate(coursePath(lesson.course))}>
            코스로
          </Button>
        )}
      </div>
      )}
    </div>
  );
}
