// 「악보 보고 빨리 치기」 화면 (설계 MODE-006-minigame-sight 4절 「한 판」). 오선에 음표 하나가 뜨면 맞는 패드를 치고, 10문제의 평균 반응 시간을 겨룬다.
// 단계(useMiniFlow)에 따라 안내 · 플레이(카운트다운·플레이·마무리는 같은 SightStage) · 결과를 조립한다.
// 문제 진행(대기 → 제시 → 확인)은 순수 상태 기계(domain/sightPlay)가 맡고, 이 화면은 타격·타이머·프레임을 사건으로 바꿔 넘긴다. 저장은 store가 한다.
// 제한 시간이 없다. 10번째 문제가 확인에 들어가면 화면이 흐름 훅에 끝을 알리고, 마무리(0.8초)가 마지막 문제의 확인을 겸한다.
import { useEffect, useReducer, useState } from 'react';
import { useShell } from '@/components/shell/nav/useShell';
import { Segmented } from '@/components/ui/form/Segmented';
import type { PadId } from '@/domain/kit/pads';
import { MiniIntro } from '@/features/mini/components/MiniIntro';
import { MiniResultHero } from '@/features/mini/components/MiniResultHero';
import { miniGameInfo } from '@/features/mini/domain/miniCatalog';
import { SightArt } from '@/features/mini/components/sight/SightArt';
import { SightResult } from '@/features/mini/components/sight/SightResult';
import { SightStage } from '@/features/mini/components/sight/SightStage';
import { hitTime } from '@/features/mini/domain/hitTime';
import { currentPad, sightFinished, startSight, stepSight, type SightEvent, type SightPlay } from '@/features/mini/domain/sightPlay';
import {
  HOLD_MS,
  NOTICE_MS,
  PROBLEM_LIMIT_MS,
  SIGHT_PROBLEMS,
  averageMs,
  canAskKick,
  formatSeconds,
  makeProblems,
  sightBestNote,
  sightPads,
  sightResultTitle,
  sightVariant,
  solvedCount,
  waitMs,
  type SightHint,
} from '@/features/mini/domain/sightRound';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { readSightHint, writeSightHint } from '@/features/mini/store/sightHintPref';
import { useMiniFlow } from '@/features/mini/useMiniFlow';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import './mini.css';

const GAME_NAME = '악보 보고 빨리 치기';
const HINT_NAME: Record<SightHint, string> = { on: '힌트 켬', off: '힌트 끔' };
const HINT_OPTIONS: { value: SightHint; label: string }[] = [
  { value: 'on', label: HINT_NAME.on },
  { value: 'off', label: HINT_NAME.off },
];

type Action = SightEvent | { type: 'reset'; problems: readonly PadId[] };

/** 새 판이면 처음 상태로, 그 밖에는 상태 기계에 사건을 넘긴다 */
function reduce(play: SightPlay, action: Action): SightPlay {
  return action.type === 'reset' ? startSight(action.problems) : stepSight(play, action);
}

export function SightGamePage() {
  useShell({ title: '미니게임' });
  const flow = useMiniFlow({ closingMs: HOLD_MS });
  const { phase, finish } = flow;
  // 힌트는 안내에서만 바꾼다. 마지막에 고른 값을 브라우저에 기억한다
  const [hint, setHint] = useState<SightHint>(readSightHint);
  const best = useMiniRecords((s) => s.best('sight', sightVariant(hint))?.score ?? null);
  const stickConnected = useLive((s) => s.connected[0] || s.connected[1]);
  const sensorKind = useSettings((s) => s.sensorKind);
  const kickConnected = useLive((s) => s.pedal.connected[1]);
  // 킥 문제를 낼 수 있는가. 출제 패드는 시작할 때 정하고 그 판이 끝날 때까지 바꾸지 않는다
  const kickOk = canAskKick(sensorKind, kickConnected);
  const [play, dispatch] = useReducer(reduce, undefined, () => startSight([]));
  const { step, waitSeq, shownAt, answers } = play;
  const finished = sightFinished(play);
  // 이 판을 시작할 때의 최고 기록(같은 힌트 갈래). 결과 문구(갱신·동점·못 미침)는 이 값과 견준다
  const [previous, setPrevious] = useState<number | null>(null);
  // [그만하기]로 안내에 돌아왔으면 [시작하기]에 포커스를 준다
  const [returned, setReturned] = useState(false);

  // 다른 탭에서 바뀐 기록도 열 때 한 번 다시 읽는다
  useEffect(() => {
    useMiniRecords.getState().reload();
  }, []);

  // 이 화면에서는 친 드럼이 울린다(자유 연습과 같은 공용 경로). 화면이 따로 소리를 내지 않는다
  useEffect(() => {
    setSoundOnHit(true);
    return () => setSoundOnHit(false);
  }, []);

  // 키보드 드럼은 치는 단계에서만 켠다. 안내·마무리·결과에서는 꺼져 있어 Space·Enter로 버튼을 누를 수 있다
  useKeyboardDrum(phase === 'countdown' || phase === 'playing');

  // 타격 구독: 플레이 단계에서만 받는다(카운트다운·마무리 중 타격은 소리만 난다). 가리는 일은 상태 기계가 한다
  useEffect(() => {
    if (phase !== 'playing') return;
    return useLive.subscribe((s, prev) => {
      const hit = s.lastHit;
      if (s.hitSeq === prev.hitSeq || !hit) return;
      // 미리 친 타격이면 남은 문제를 다시 섞는다. 상태 기계가 순수하게 남도록 난수는 씨앗으로 넘긴다
      dispatch({ type: 'hit', id: hit.id, pad: hit.pad, at: hitTime(hit), seed: Math.floor(Math.random() * 0x100000000) });
    });
  }, [phase]);

  // 대기: 무작위 간격 뒤에 음표를 낸다. 미리 친 타격으로 대기가 다시 시작되면(waitSeq) 새 간격을 잰다
  useEffect(() => {
    if (phase !== 'playing' || step !== 'wait') return;
    const timer = setTimeout(() => dispatch({ type: 'show' }), waitMs(Math.random));
    return () => clearTimeout(timer);
  }, [phase, step, waitSeq]);

  // 제시: 음표를 그린 뒤 첫 프레임의 시각을 제시 시각으로 잡는다. 그 전에 온 타격은 미리 친 것이다
  useEffect(() => {
    if (phase !== 'playing' || step !== 'shown' || shownAt !== null) return;
    const frame = requestAnimationFrame(() => dispatch({ type: 'painted', at: performance.now() }));
    return () => cancelAnimationFrame(frame);
  }, [phase, step, shownAt, waitSeq]);

  // 제시: 한 문제의 상한. 남은 시간은 제시 시각에서 다시 계산한다(효과가 다시 걸려도 끝나는 때가 밀리지 않는다)
  useEffect(() => {
    if (phase !== 'playing' || step !== 'shown' || shownAt === null) return;
    const left = Math.max(0, PROBLEM_LIMIT_MS - (performance.now() - shownAt));
    const timer = setTimeout(() => dispatch({ type: 'timeout' }), left);
    return () => clearTimeout(timer);
  }, [phase, step, shownAt]);

  // 확인: 잠깐 결과를 보인 뒤 다음 문제로. 마지막 문제면 끝을 알린다(공용 흐름의 마무리가 확인을 겸한다)
  useEffect(() => {
    if (phase !== 'playing' || step !== 'hold') return;
    if (finished) {
      finish();
      return;
    }
    const timer = setTimeout(() => dispatch({ type: 'next' }), HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase, step, finished, finish]);

  // 알림(「아직이에요」·「틀렸어요」)은 잠깐만 보인다. 그사이 새 알림이 뜨면 시간을 다시 잰다
  const noticeSeq = play.notice?.seq ?? null;
  useEffect(() => {
    if (noticeSeq === null) return;
    const timer = setTimeout(() => dispatch({ type: 'clearNotice', seq: noticeSeq }), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [noticeSeq]);

  // 결과가 확정될 때만 기록을 쓴다(중간에 나간 판은 남지 않는다). 한 문제도 못 맞힌 판은 남기지 않는다.
  // 같은 점수로 다시 불려도 동점은 갱신이 아니라서 저장 값이 바뀌지 않는다
  useEffect(() => {
    if (phase !== 'result' || !finished || solvedCount(answers) === 0) return;
    useMiniRecords.getState().submit({
      gameId: 'sight',
      variant: sightVariant(hint),
      score: averageMs(answers),
      at: new Date().toISOString(),
      detail: { problems: [...answers] },
    });
  }, [phase, finished, answers, hint]);

  /** 새 판 준비: 출제 패드를 정해 문제를 뽑고, 지금의 최고 기록을 견줄 값으로 잡는다 */
  const begin = () => {
    dispatch({ type: 'reset', problems: makeProblems(sightPads(kickOk), Math.random) });
    setPrevious(useMiniRecords.getState().best('sight', sightVariant(hint))?.score ?? null);
  };
  const onStart = () => {
    // 오디오 잠금을 풀지 못해도 소리 없이 진행한다(기록은 소리와 무관하다)
    void unlockAudio().catch(() => undefined);
    begin();
    flow.start();
  };
  const onRetry = () => {
    begin();
    flow.retry();
  };
  const onQuit = () => {
    dispatch({ type: 'reset', problems: [] });
    setReturned(true);
    flow.quit();
  };
  const onHint = (next: SightHint) => {
    setHint(next);
    writeSightHint(next);
  };

  if (phase === 'intro') {
    return (
      <main className="main">
        <MiniIntro
          overline={GAME_NAME}
          title={['음표가 뜨면', '맞는 패드를 바로 치세요.']}
          description={miniGameInfo('sight').description}
          art={<SightArt size="hero" />}
          cells={[
            { label: '한 판', value: String(SIGHT_PROBLEMS), unit: '문제', note: '패드가 고르게 나와요' },
            { label: '재는 것', value: '평균 반응', note: '음표가 뜬 때부터 맞힐 때까지' },
            best === null
              ? { label: '내 최고 기록', value: '—', note: '이 브라우저에 저장돼요' }
              : { label: '내 최고 기록', value: formatSeconds(best), unit: '초', note: `${HINT_NAME[hint]} 기록이에요` },
          ]}
          stickConnected={stickConnected}
          controls={
            <>
              <Segmented label="힌트" value={hint} onChange={onHint} options={HINT_OPTIONS} />
              <span className="mini-intro-msg">
                <span>힌트를 켜면 패드 이름이 같이 보여요. 기록은 따로 남아요.</span>
              </span>
            </>
          }
          note={kickOk ? undefined : '킥 페달이 연결돼 있지 않아 킥은 빼고 낼게요.'}
          focusStart={returned}
          onStart={onStart}
        />
      </main>
    );
  }

  if (phase === 'result') {
    const score = averageMs(answers);
    // 한 문제도 못 맞혔으면 기록도 견줄 값도 없다
    const note = solvedCount(answers) > 0 ? sightBestNote(score, previous) : null;
    return (
      <main className="main">
        <div className="mini-page">
          <MiniResultHero
            overline={`${GAME_NAME} · ${HINT_NAME[hint]}`}
            newBest={note?.newBest ?? false}
            title={sightResultTitle(answers)}
            score={
              note === null
                ? { label: '평균 반응', value: '—' }
                : { label: '평균 반응', value: formatSeconds(score), unit: '초', note: note.text }
            }
            onRetry={onRetry}
          />
          <SightResult answers={answers} />
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <SightStage
        phase={phase}
        countdown={flow.countdown}
        hint={hint}
        total={play.problems.length || SIGHT_PROBLEMS}
        answers={answers}
        step={step}
        pad={currentPad(play)}
        shownAt={shownAt}
        wrongs={play.wrongs}
        notice={play.notice?.kind ?? null}
        onQuit={onQuit}
      />
    </main>
  );
}
