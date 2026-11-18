// 원형 스테이지 맵 (설계 SETUP-입문-코스 3-5). 스테이지가 구불구불한 길을 따라 순서대로 놓인다. 잠긴 스테이지는 고를 수 없다.
// 한 코스의 스테이지만 받는다. 맨 아래 목표 문구는 코스마다 다르다(설계 SETUP-학습-코스-중급 4-1).
import { lessonDisplayTitle, stageWord, type Lesson, type StageState } from '@/domain/play/lesson';

/** 스테이지 가로 흔들림(px). 순서대로 돌려 쓴다 */
const OFFSETS = [0, 64, 88, 48, -16, -72, -88, -40];
const STEP = 96;
const TOP = 50;
const WIDTH = 320;
const LABEL_W = 126;

interface Props {
  lessons: readonly Lesson[];
  states: readonly StageState[];
  selected: number | null;
  /** 맨 아래 목표 문구(다 통과 전·후) */
  goal: string;
  reached: string;
  onSelect: (index: number) => void;
}

export function StageMap({ lessons, states, selected, goal, reached, onSelect }: Props) {
  const x = (i: number) => WIDTH / 2 + OFFSETS[i % OFFSETS.length];
  const y = (i: number) => TOP + i * STEP;
  const height = TOP + Math.max(0, lessons.length - 1) * STEP + 92;
  const points = lessons.map((_, i) => `${x(i)},${y(i)}`);
  const doneUntil = Math.min(states.filter((s) => s === 'passed').length + 1, lessons.length);
  const done = points.slice(0, doneUntil);
  const allPassed = lessons.length > 0 && states.every((s) => s === 'passed');
  return (
    <div className="lesson-map" style={{ height }}>
      <svg className="lesson-map-path" viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline className="lesson-map-path-all" points={points.join(' ')} />
        {done.length > 1 && <polyline className="lesson-map-path-done" points={done.join(' ')} />}
      </svg>
      <ol className="lesson-map-list">
        {lessons.map((l, i) => {
          const state = states[i];
          const right = OFFSETS[i % OFFSETS.length] <= 0;
          const word = stageWord(l, state);
          const title = lessonDisplayTitle(l.title);
          return (
            <li key={l.songId}>
              <button
                type="button"
                className={`lesson-stage is-${state}${selected === i ? ' is-selected' : ''}`}
                style={{ left: x(i), top: y(i) }}
                aria-label={`${l.order}번 ${title}, ${word}`}
                aria-pressed={selected === i}
                aria-disabled={state === 'locked'}
                onClick={() => state !== 'locked' && onSelect(i)}
              >
                {state === 'passed' ? <CheckIcon /> : state === 'locked' ? <LockIcon /> : l.order}
              </button>
              <span
                className={`lesson-stage-label${state === 'locked' ? ' is-dim' : ''}`}
                style={
                  right
                    ? { top: y(i), left: x(i) + 46, width: Math.min(LABEL_W, WIDTH - (x(i) + 46)), textAlign: 'left' }
                    : { top: y(i), left: Math.max(0, x(i) - 46 - LABEL_W), width: Math.min(LABEL_W, x(i) - 46), textAlign: 'right' }
                }
                aria-hidden="true"
              >
                <b>{title}</b>
                {word}
              </span>
            </li>
          );
        })}
      </ol>
      <span className={`lesson-map-goal${allPassed ? ' is-reached' : ''}`} style={{ top: height - 40 }}>
        {allPassed ? reached : goal}
      </span>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** 체크박스(ui/Checkbox)와 같은 모양의 체크를 스테이지 크기로 */
function CheckIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5l2.5 2.5 4.5-5" />
    </svg>
  );
}
