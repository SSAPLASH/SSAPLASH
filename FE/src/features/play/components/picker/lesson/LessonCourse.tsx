// 악보 연습 곡 선택의 [학습 코스] 본문 (Jira 331, 설계 SETUP-입문-코스 3-5·4-4, SETUP-학습-코스-중급 4-1·4-2).
// 코스 칸(입문·중급), 고른 코스의 원형 스테이지 맵, 고른 레슨의 카드. 코스는 주소 `course`가 있으면 그 코스, 없으면 진도에 맞춰 고른다.
// 탭을 열 때마다 진도를 다시 읽는다(방금 친 레슨이 반영되게). 잠금은 전체 목록(입문 → 중급)에서 계산하므로 입문을 다 통과해야 중급이 열린다.
// 연주는 기존 악보 연습 화면으로 넘긴다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  courseMeta,
  courseOfQuery,
  courseProgress,
  courseQuery,
  defaultCourse,
  lessonDisplayTitle,
  lessonPath,
  stageStates,
  stageWord,
  type LessonCourse as Course,
} from '@/domain/play/lesson';
import type { PadVisualState } from '@/domain/kit/drumKit';
import type { PadId } from '@/domain/kit/pads';
import { useLessons } from '@/store/lessonStore';
import { Button } from '@/components/ui/action/Button';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { DrumKit } from '@/components/drum/DrumKit';
import { CoursePicker } from './CoursePicker';
import { PadNotation } from '@/components/lesson/PadNotation';
import { StageMap } from './StageMap';
import '@/components/lesson/lesson.css';
import { InlineError } from '@/components/ui/feedback/InlineError';

export function LessonCourse({ onOpenBuiltin }: { onOpenBuiltin: () => void }) {
  const status = useLessons((s) => s.status);
  const list = useLessons((s) => s.list);
  const localPassed = useLessons((s) => s.localPassed);
  const load = useLessons((s) => s.load);
  const dismissInvite = useLessons((s) => s.dismissInvite);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // 코스마다 고른 스테이지(코스 안 번호). 다른 코스로 가면 그 코스의 도전할 스테이지부터 보인다
  const [picked, setPicked] = useState<{ course: Course; index: number } | null>(null);

  useEffect(() => {
    void load(true);
  }, [load]);

  // 코스에 한 번 들어왔으면 권유 카드는 할 일을 마쳤다. 어느 길로 들어왔든 [닫기]처럼 기억해 다시 띄우지 않는다
  useEffect(() => {
    dismissInvite();
  }, [dismissInvite]);

  const lessons = useMemo(() => list?.items ?? [], [list]);
  const states = useMemo(() => stageStates(lessons, localPassed), [lessons, localPassed]);
  const progress = useMemo(() => courseProgress(lessons, states), [lessons, states]);

  if (status === 'error' && !list) {
    return (
      <InlineError size="lg" onRetry={() => void load(true)}>
        학습 코스를 불러오지 못했어요.
      </InlineError>
    );
  }
  if (!list) {
    return (
      <div className="play-sp-center">
        <span className="spinner" aria-label="불러오는 중" />
      </div>
    );
  }
  if (lessons.length === 0) return <EmptyState title="학습 코스를 준비하고 있어요" description="곧 열릴 예정이에요." />;

  const wanted = courseOfQuery(params.get('course'));
  const course: Course = wanted && progress.some((p) => p.course === wanted) ? wanted : defaultCourse(lessons, states);
  const at = progress.findIndex((p) => p.course === course);
  const prevCourse = at > 0 ? progress[at - 1] : null;
  const nextCourse = progress[at + 1]?.course ?? null;
  const meta = courseMeta(course);
  // 이 코스의 레슨과 상태(전체 목록에서 계산한 값을 그대로 잘라 쓴다)
  const idx = lessons.flatMap((l, i) => (l.course === course ? [i] : []));
  const courseLessons = idx.map((i) => lessons[i]);
  const courseStates = idx.map((i) => states[i]);
  const allPassed = courseStates.every((s) => s === 'passed');
  const firstOpen = courseStates.indexOf('open');
  const pickedIndex = picked?.course === course ? picked.index : null;
  // 고른 스테이지가 없거나 잠겼으면 지금 도전할 스테이지(없으면 null = 완료·잠김 카드)
  const selected = pickedIndex !== null && courseStates[pickedIndex] !== undefined && courseStates[pickedIndex] !== 'locked' ? pickedIndex : firstOpen >= 0 ? firstOpen : null;

  // 코스를 바꾸면 주소에 남긴다(방문 기록은 쌓지 않는다)
  const selectCourse = (next: Course) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('course', courseQuery(next));
        return p;
      },
      { replace: true },
    );

  const lesson = selected === null ? null : courseLessons[selected];
  const kitStates: Partial<Record<PadId, PadVisualState>> = {};
  for (const p of lesson?.pads ?? []) kitStates[p] = 'armed';

  return (
    <section className="lesson-course" aria-label="학습 코스">
      <CoursePicker progress={progress} selected={course} onSelect={selectCourse} />
      <p className="lesson-course-note">앞 스테이지를 통과하면 다음 스테이지가 열려요. 연주 레슨은 정확도 {list.passAccuracy}% 이상이 통과예요.</p>

      <div className="lesson-course-grid">
        <div className="lesson-map-wrap">
          <StageMap
            lessons={courseLessons}
            states={courseStates}
            selected={selected}
            goal={meta.goal}
            reached={meta.reached}
            onSelect={(index) => setPicked({ course, index })}
          />
        </div>
        {lesson && selected !== null ? (
          <div className={`lesson-card is-${courseStates[selected]}`}>
            <span className="lesson-card-eyebrow">{stageWord(lesson, courseStates[selected])}</span>
            <h3 className="lesson-card-title">
              {lesson.order}. {lessonDisplayTitle(lesson.title)}
            </h3>
            <p className="lesson-card-summary">{lesson.summary}</p>
            <div className="lesson-card-figures">
              <PadNotation pads={lesson.pads} />
              <div className="lesson-card-kit">
                <DrumKit fitWidth labels states={kitStates} />
              </div>
            </div>
            <div className="lesson-card-actions">
              <Button onClick={() => navigate(lessonPath(lesson))}>{lesson.kind === 'READ' ? (courseStates[selected] === 'passed' ? '다시 연습하기' : '레슨 시작하기') : '플레이'}</Button>
            </div>
          </div>
        ) : allPassed ? (
          <div className="lesson-card is-passed">
            <span className="lesson-card-eyebrow">코스 완료</span>
            <h3 className="lesson-card-title">{meta.reached}</h3>
            <p className="lesson-card-summary">{`${nextCourse ? courseMeta(nextCourse).invite : meta.doneText} 지나온 스테이지를 누르면 다시 연습할 수 있어요.`}</p>
            <div className="lesson-card-actions">
              <Button variant={nextCourse ? 'secondary' : 'primary'} onClick={onOpenBuiltin}>
                기본 곡 보러 가기
              </Button>
              {nextCourse && <Button onClick={() => selectCourse(nextCourse)}>{`${courseMeta(nextCourse).name} 시작하기`}</Button>}
            </div>
          </div>
        ) : (
          // 이 코스에 도전할 스테이지가 없다 = 앞 코스가 남았다
          <div className="lesson-card is-locked">
            <span className="lesson-card-eyebrow">잠김</span>
            <h3 className="lesson-card-title">{prevCourse ? `${courseMeta(prevCourse.course).name}를 먼저 통과해요` : '앞 스테이지를 먼저 통과해요'}</h3>
            {prevCourse && (
              <p className="lesson-card-summary">
                {`${meta.name}는 ${courseMeta(prevCourse.course).name} ${prevCourse.total}개를 다 통과하면 열려요. 지금은 ${prevCourse.total}개 중 ${prevCourse.passed}개를 통과했어요.`}
              </p>
            )}
            {prevCourse && (
              <div className="lesson-card-actions">
                <Button onClick={() => selectCourse(prevCourse.course)}>{`${courseMeta(prevCourse.course).name} 이어 하기`}</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
