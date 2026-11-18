// 학습 코스 알아보기 레슨 (Jira 331, 설계 SETUP-입문-코스 4-3, SETUP-학습-코스-중급 4-3). 화면 이름·돌아가는 곳은 그 레슨의 코스다. 악보가 흐르지 않는다. 음표를 한 줄로 늘어놓고
// 지금 칠 음표의 드럼을 치면 다음 음표로 넘어간다. 틀리면 넘어가지 않고 답을 알려 준다. 시간·판정 기록은 없다.
// 소리·텔레메트리는 자유 연습처럼 공용 경로(setSoundOnHit)가 내고, 이 화면은 마지막 타격만 구독한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { postLessonCompletion } from '@/api/play/lessons';
import { setSoundOnHit } from '@/runtime/hitSound';
import { unlockAudio } from '@/runtime/audioUnlock';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { touchSource } from '@/runtime/sources';
import {
  LESSONS_PATH,
  autoAdvanceTarget,
  autoAdvanceText,
  courseFinishText,
  courseMeta,
  coursePath,
  lessonDisplayTitle,
  lessonPath,
  nextLesson,
  readDeviceHint,
  readPrompt,
  readSequence,
  readStep,
} from '@/domain/play/lesson';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import type { PadVisualState } from '@/domain/kit/drumKit';
import type { PadId } from '@/domain/kit/pads';
import { audioEngine } from '@/audio/AudioEngine';
import { useLessons } from '@/store/lessonStore';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { loadChart } from '@/store/songStore';
import { useShell } from '@/components/shell/nav/useShell';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { Button } from '@/components/ui/action/Button';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { LiveDrumKit } from '@/components/drum/LiveDrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { ReadStaff } from '@/components/lesson/PadNotation';
import '@/components/lesson/lesson.css';
import { InlineError } from '@/components/ui/feedback/InlineError';
import { useAutoAdvance } from '@/components/lesson/useAutoAdvance';

type Save = 'idle' | 'saving' | 'saved' | 'failed';

export function LessonReadPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const songId = Number(useParams().songId);
  const list = useLessons((s) => s.list);
  const status = useLessons((s) => s.status);
  const load = useLessons((s) => s.load);
  const markPassed = useLessons((s) => s.markPassed);
  const sensorKind = useSettings((s) => s.sensorKind);
  const kitSkin = useSettings((s) => s.kitSkin);
  // 친 패드가 흔들리고 이펙트가 나는 모션(자유 연습과 같은 훅)
  const hitStates = usePadStates();
  const hitSeq = usePadHitSeq();
  const connected = useLive((s) => s.connected);
  const pedalPair = useLive((s) => s.pedal.connected);

  const lesson = list?.items.find((l) => l.songId === songId && l.kind === 'READ');
  const next = lesson && list ? nextLesson(list.items, lesson.songId) : null;
  // 레슨을 찾기 전·못 찾으면 학습 코스 전체 이름
  const courseName = lesson ? courseMeta(lesson.course).name : '학습 코스';
  useShell({ title: courseName });
  const [seq, setSeq] = useState<PadId[] | null>(null);
  const [chartError, setChartError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [at, setAt] = useState(0);
  const [miss, setMiss] = useState(false);
  // 틀릴 때마다 안내 문구를 다시 흔들기 위한 횟수
  const [missCount, setMissCount] = useState(0);
  const [save, setSave] = useState<Save>('idle');
  // 완료 팝업. 닫으면 같은 화면에 [다시 하기]·[코스로]가 남는다
  const [popup, setPopup] = useState(false);
  const done = seq !== null && seq.length > 0 && at >= seq.length;
  const nextButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // 이 화면은 처음부터 끝까지 치는 화면이라 자유 연습처럼 키보드 드럼을 계속 받는다(떠나면 끈다)
  useKeyboardDrum(true);

  // 이 화면에서는 친 드럼이 울린다(자유 연습과 같은 공용 경로)
  useEffect(() => {
    setSoundOnHit(true);
    return () => setSoundOnHit(false);
  }, []);

  const chartKey = lesson ? `${lesson.songId}:${lesson.chartId}` : null;
  useEffect(() => {
    if (!lesson) return;
    const ac = new AbortController();
    loadChart({ songId: lesson.songId, chartId: lesson.chartId }, ac.signal).then(
      (loaded) => {
        if (ac.signal.aborted) return;
        setSeq(readSequence(loaded.chart.notes));
        setChartError(false);
      },
      () => {
        if (!ac.signal.aborted) setChartError(true);
      },
    );
    return () => ac.abort();
    // 레슨 객체가 아니라 곡·채보가 바뀔 때만 다시 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartKey, retry]);

  const complete = useCallback(() => {
    if (!lesson) return;
    markPassed(lesson.songId);
    setSave('saving');
    postLessonCompletion(lesson.songId).then(
      () => setSave('saved'),
      () => setSave('failed'),
    );
  }, [lesson, markPassed]);

  // 타격: 지금 음표의 패드인지 본다. 상태는 ref로 읽어 구독을 한 번만 건다
  const progress = useRef({ seq, at, done });
  progress.current = { seq, at, done };
  useEffect(() => {
    return useLive.subscribe((s, prev) => {
      if (s.hitSeq === prev.hitSeq || !s.lastHit?.pad) return;
      const cur = progress.current;
      if (!cur.seq || cur.done) return;
      const step = readStep(cur.seq, cur.at, s.lastHit.pad);
      setMiss(step.miss);
      if (step.miss) setMissCount((n) => n + 1);
      if (step.at !== cur.at) setAt(step.at);
      if (step.done && !cur.done) {
        setPopup(true);
        // 다시 해서 또 끝내도 완료 저장은 처음 한 번만(실패했으면 팝업의 [다시 저장])
        if (save === 'idle') complete();
      }
    });
  }, [complete, save]);

  const restart = () => {
    setAt(0);
    setMiss(false);
    setPopup(false);
  };

  // 드럼 그림을 눌러서도 칠 수 있다(스틱이 없을 때). 타격은 위 구독으로 들어온다
  const onPadDown = (pad: PadId) => {
    if (audioEngine.ready) touchSource.strike(pad);
    else void unlockAudio().then(() => touchSource.strike(pad));
  };

  const target = seq && !done ? seq[at] : null;
  const showAnswer = target !== null && (lesson?.guide === true || miss);
  const kitStates = useMemo(() => {
    const states: Partial<Record<PadId, PadVisualState>> = {};
    if (showAnswer && target) states[target] = 'armed';
    // 방금 친 패드의 타격 모양이 정답 표시보다 앞선다
    return { ...states, ...hitStates };
  }, [showAnswer, target, hitStates]);

  // 완료 팝업이 떠 있는 동안 3초 뒤 다음 레슨으로 넘긴다(같은 코스일 때만). 저장 실패가 떠 있으면 세지 않는다(설계 SETUP-학습-코스-자동-넘김 4-2)
  const autoTarget = lesson ? autoAdvanceTarget(lesson, next, done) : null;
  const auto = useAutoAdvance({
    enabled: done && popup && save !== 'failed' && autoTarget !== null,
    onGo: () => {
      if (autoTarget) navigate(lessonPath(autoTarget, { auto: true }));
    },
  });

  const toCourse = () => navigate(lesson ? coursePath(lesson.course) : LESSONS_PATH);
  const back = (
    <div className="lesson-read-back">
      <Button variant="text" size="sm" onClick={toCourse}>
        {`← ${courseName}`}
      </Button>
    </div>
  );

  if (!list) {
    if (status === 'error') {
      return (
        <main className="main">
          <InlineError size="lg" onRetry={() => void load(true)}>
            학습 코스를 불러오지 못했어요.
          </InlineError>
        </main>
      );
    }
    return (
      <main className="main">
        <span className="spinner" aria-label="불러오는 중" />
      </main>
    );
  }
  if (!lesson) {
    return (
      <main className="main">
        <EmptyState
          title="레슨을 찾을 수 없어요"
          description="학습 코스에서 다시 골라 주세요."
          action={<Button onClick={toCourse}>학습 코스로</Button>}
        />
      </main>
    );
  }

  const deviceHint = readDeviceHint({
    sensorKind,
    hasUsageGuide: sensorKind !== 'none' && !!sensorRegistry.get(sensorKind)?.usageGuide,
    sticks: connected,
    pedal: pedalPair,
    pads: seq ?? lesson.pads,
  });
  return (
    <main className="main lesson-read-main">
      {back}
      <section className="lesson-read" aria-label={`${lesson.order}. ${lessonDisplayTitle(lesson.title)}`}>
        <h2 className="lesson-card-title">
          {lesson.order}. {lessonDisplayTitle(lesson.title)}
        </h2>
        {deviceHint && !done && (
          <div className="notice col">
            <span>{deviceHint}</span>
            <Button variant="secondary" size="sm" onClick={() => navigate('/setup', { state: { returnTo: pathname, returnLabel: courseName } })}>
              드럼 세팅
            </Button>
          </div>
        )}

        {chartError && (
          <InlineError size="lg" onRetry={() => setRetry((n) => n + 1)}>
            레슨 악보를 불러오지 못했어요.
          </InlineError>
        )}
        {!chartError && seq === null && <span className="spinner" aria-label="불러오는 중" />}

        {seq !== null && (
          <div className="lesson-read-card">
            <p key={missCount} className={`lesson-read-prompt${miss ? ' is-miss' : ''}`} role="status">
              {target ? readPrompt(target, lesson.guide, miss) : '모두 쳤어요! 다시 하거나 코스로 돌아갈 수 있어요.'}
            </p>
            <ReadStaff pads={seq} at={at} />
            <div className="lesson-read-kit" data-skin={kitSkin}>
              <LiveDrumKit fitWidth effects labels skin={kitSkin} states={kitStates} hitSeq={hitSeq} onPadDown={onPadDown} />
            </div>
            {done && !popup && (
              <div className="lesson-read-actions">
                <Button onClick={restart}>다시 하기</Button>
                <Button variant="secondary" onClick={toCourse}>
                  코스로
                </Button>
              </div>
            )}
          </div>
        )}

        {done && popup && seq && (
          <Dialog onClose={() => setPopup(false)} labelledBy="lesson-done-title" initialFocusRef={next ? nextButton : undefined} className="lesson-done-dialog">
            <h2 id="lesson-done-title" className="lesson-done-title">
              레슨 완료!
            </h2>
            <p className="lesson-done-text">
              음표 {seq.length}개를 모두 쳤어요. {courseFinishText(lesson, next)}
            </p>
            {save === 'failed' && (
              <InlineError onRetry={complete} retryLabel="다시 저장">
                진도를 저장하지 못했어요. 이번 접속에서는 다음 스테이지가 열려 있어요.
              </InlineError>
            )}
            {auto.remaining !== null && next ? (
              <div className="lesson-done-actions">
                <span className="lesson-auto-text" aria-live="polite">
                  {autoAdvanceText(auto.remaining)}
                </span>
                <Button variant="secondary" onClick={auto.stop}>
                  머무르기
                </Button>
                <Button ref={nextButton} data-auto-go onClick={auto.goNow}>
                  지금 가기
                </Button>
              </div>
            ) : (
              <div className="lesson-done-actions">
                <Button variant="secondary" onClick={toCourse}>
                  코스로
                </Button>
                {next && (
                  <Button ref={nextButton} onClick={() => navigate(lessonPath(next))}>
                    다음 레슨
                  </Button>
                )}
              </div>
            )}
          </Dialog>
        )}
      </section>
    </main>
  );
}
