// 악보 연습 곡 선택의 [입문 코스] 탭 본문 (Jira 331, 설계 SETUP-입문-코스 3-5·4-4). 진도, 원형 스테이지 맵, 고른 레슨의 카드.
// 탭을 열 때마다 진도를 다시 읽는다(방금 친 레슨이 반영되게). 연주는 기존 악보 연습 화면으로 넘긴다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lessonDisplayTitle, lessonPath, stageStates, stageWord } from '@/domain/play/lesson';
import type { PadVisualState } from '@/domain/kit/drumKit';
import type { PadId } from '@/domain/kit/pads';
import { useLessons } from '@/store/lessonStore';
import { Button } from '@/components/ui/action/Button';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { DrumKit } from '@/components/drum/DrumKit';
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
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    void load(true);
  }, [load]);

  // 코스에 한 번 들어왔으면 권유 카드는 할 일을 마쳤다. 어느 길로 들어왔든 [닫기]처럼 기억해 다시 띄우지 않는다
  useEffect(() => {
    dismissInvite();
  }, [dismissInvite]);

  const lessons = useMemo(() => list?.items ?? [], [list]);
  const states = useMemo(() => stageStates(lessons, localPassed), [lessons, localPassed]);
  const firstOpen = states.indexOf('open');
  // 고른 스테이지가 없거나 잠겼으면 지금 도전할 스테이지(다 통과했으면 null = 완료 카드)
  const selected = picked !== null && states[picked] !== undefined && states[picked] !== 'locked' ? picked : firstOpen >= 0 ? firstOpen : null;

  if (status === 'error' && !list) {
    return (
      <InlineError size="lg" onRetry={() => void load(true)}>
        입문 코스를 불러오지 못했어요.
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
  if (lessons.length === 0) return <EmptyState title="입문 코스를 준비하고 있어요" description="곧 열릴 예정이에요." />;

  const passedCount = states.filter((s) => s === 'passed').length;
  const lesson = selected === null ? null : lessons[selected];
  const kitStates: Partial<Record<PadId, PadVisualState>> = {};
  for (const p of lesson?.pads ?? []) kitStates[p] = 'armed';

  return (
    <section className="lesson-course" aria-label="입문 코스">
      <div className="lesson-progress">
        <div className="lesson-progress-label">
          <span>앞 스테이지를 통과하면 다음 스테이지가 열려요. 연주 레슨은 정확도 {list.passAccuracy}% 이상이 통과예요.</span>
          <b>
            {lessons.length}개 중 {passedCount}개 통과
          </b>
        </div>
        <div className="lesson-progress-bar" role="progressbar" aria-label="입문 코스 진도" aria-valuemin={0} aria-valuemax={lessons.length} aria-valuenow={passedCount}>
          <i style={{ width: `${(passedCount / lessons.length) * 100}%` }} />
        </div>
      </div>

      <div className="lesson-course-grid">
        <div className="lesson-map-wrap">
          <StageMap lessons={lessons} states={states} selected={selected} onSelect={setPicked} />
        </div>
        {lesson && selected !== null ? (
          <div className={`lesson-card is-${states[selected]}`}>
            <span className="lesson-card-eyebrow">{stageWord(lesson, states[selected])}</span>
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
              <Button onClick={() => navigate(lessonPath(lesson))}>{lesson.kind === 'READ' ? (states[selected] === 'passed' ? '다시 연습하기' : '레슨 시작하기') : '플레이'}</Button>
            </div>
          </div>
        ) : (
          <div className="lesson-card is-passed">
            <span className="lesson-card-eyebrow">코스 완료</span>
            <h3 className="lesson-card-title">8비트를 칠 수 있게 됐어요</h3>
            <p className="lesson-card-summary">이제 기본 곡의 「기본 8비트」와 쉬운 곡으로 넘어가 보세요. 지나온 스테이지를 누르면 다시 연습할 수 있어요.</p>
            <div className="lesson-card-actions">
              <Button onClick={onOpenBuiltin}>기본 곡 보러 가기</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
