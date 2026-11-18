// 학습 코스의 코스 칸(설계 SETUP-학습-코스-중급 4-1). 레슨이 있는 코스마다 이름·한 줄 설명·진도를 보이고, 누르면 그 코스를 고른다.
// 진도는 받은 값만 그린다(계산은 domain/play/lesson의 courseProgress). 잠긴 코스도 눌러 볼 수 있다.
import { courseMeta, type CourseProgress, type LessonCourse } from '@/domain/play/lesson';

interface Props {
  progress: readonly CourseProgress[];
  selected: LessonCourse;
  onSelect: (course: LessonCourse) => void;
}

export function CoursePicker({ progress, selected, onSelect }: Props) {
  return (
    <div className="lesson-courses" role="group" aria-label="코스 고르기">
      {progress.map((p, i) => {
        const meta = courseMeta(p.course);
        const done = p.passed === p.total;
        const prev = i > 0 ? courseMeta(progress[i - 1].course) : null;
        return (
          <button
            key={p.course}
            type="button"
            className={`lesson-course-pick${p.locked ? ' is-locked' : ''}`}
            aria-pressed={p.course === selected}
            onClick={() => onSelect(p.course)}
          >
            <span className="lesson-course-pick-top">
              <b>{meta.name}</b>
              {done ? <span className="lesson-course-pick-done">코스 완료</span> : <span className="lesson-course-pick-count">{`${p.total}개 중 ${p.passed}개 통과`}</span>}
            </span>
            <span className="lesson-course-pick-summary">{meta.summary}</span>
            {p.locked && prev ? (
              <span className="lesson-course-pick-lock">
                <LockIcon />
                {`${prev.name}를 다 통과하면 열려요`}
              </span>
            ) : (
              <span
                className="lesson-progress-bar"
                role="progressbar"
                aria-label={`${meta.name} 진도`}
                aria-valuemin={0}
                aria-valuemax={p.total}
                aria-valuenow={p.passed}
              >
                <i style={{ width: `${(p.passed / p.total) * 100}%` }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
