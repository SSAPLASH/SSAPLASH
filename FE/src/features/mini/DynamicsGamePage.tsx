// 「강약중강약」 화면 (설계 MODE-006-minigame-dynamics-match 4절 「한 판」). 한 판은 두 단계다.
// 1단계(감 잡기)는 약·중·강을 한 번씩 쳐서 내 세기를 재고, 2.5초 뒤 저절로 2단계(숫자 맞추기)로 넘어가 화면이 띄운 숫자 세 개에 맞춰 친다. 기록은 세 타의 오차 합이다.
// 단계(useMiniFlow)에 따라 안내 · 플레이(카운트다운·플레이·마무리는 같은 DynamicsStage) · 결과를 조립한다. 계산은 domain/dynamicsRound, 저장은 store가 한다.
// 제한 시간이 없다. 2단계의 3타째를 받으면 화면이 흐름 훅에 끝을 알리고, 마무리(1.2초) 동안 세 번째 결과를 보인 뒤 결과로 간다.
// 타격은 그 판에 받은 것을 받은 순서대로 담아 두고, 어느 단계의 타수로 받을지는 시각으로 가린다(카운트다운 중·단계 사이·보호 시간 안의 타격은 빠진다).
// 키보드 드럼은 켜지 않는다 — 키보드는 세기가 고정이라 받지 않고, 꺼 두면 어느 단계에서든 Space·Enter로 버튼을 누를 수 있다.
import { useEffect, useState } from 'react';
import { useShell } from '@/components/shell/nav/useShell';
import type { ResolvedHit } from '@/domain/events';
import { MiniIntro } from '@/features/mini/components/MiniIntro';
import { MiniResultHero } from '@/features/mini/components/MiniResultHero';
import { DynamicsArt } from '@/features/mini/components/dynamics/DynamicsArt';
import { DynamicsResult } from '@/features/mini/components/dynamics/DynamicsResult';
import { DynamicsStage } from '@/features/mini/components/dynamics/DynamicsStage';
import {
  DYNAMICS_CLOSING_MS,
  DYNAMICS_SHOTS,
  FEEL_REVIEW_MS,
  bestNote,
  collectFeel,
  collectMatch,
  dynamicsStep,
  formatDynamicsScore,
  makeMatchTargets,
  matchScore,
  roundRemark,
  worstShot,
} from '@/features/mini/domain/dynamicsRound';
import { VELOCITY_PAD, WRONG_PAD_HINT_MS, canStartVelocityGame, isWrongPad } from '@/features/mini/domain/velocityShot';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { useMiniFlow } from '@/features/mini/useMiniFlow';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import './mini.css';

const GAME_NAME = '강약중강약';

export function DynamicsGamePage() {
  useShell({ title: '미니게임' });
  const flow = useMiniFlow({ closingMs: DYNAMICS_CLOSING_MS });
  const { phase, startedAt, finish } = flow;
  const best = useMiniRecords((s) => s.best('dynamics')?.score ?? null);
  const sensorKind = useSettings((s) => s.sensorKind);
  const connected = useLive((s) => s.connected);
  // 세기를 재는 입력이 준비됐는가. 자유 연습·상단 연결 표시와 같은 판정이다
  const hasUsageGuide = sensorKind !== 'none' && !!sensorRegistry.get(sensorKind)?.usageGuide;
  const ready = canStartVelocityGame(sensorKind, hasUsageGuide, connected);
  // 이 판(카운트다운부터 마지막 타까지)에 받은 타격. 받은 순서대로, 같은 타격은 id로 한 번만 담는다
  const [hits, setHits] = useState<readonly ResolvedHit[]>([]);
  // 숫자 맞추기가 시작된 시각(`performance.now()`)과 그때 뽑은 목표 3개. 감 잡기와 「내 세기」를 보이는 동안은 null·빈 값이다
  const [matchAt, setMatchAt] = useState<number | null>(null);
  const [targets, setTargets] = useState<readonly number[]>([]);
  // 스네어가 아닌 패드를 친 횟수. 0이 아니면 「스네어를 쳐 주세요」를 보인다(스네어를 치거나 시간이 지나면 0으로 돌아간다)
  const [wrongSeq, setWrongSeq] = useState(0);
  // 이 판을 시작할 때의 최고 기록. 결과 문구(갱신·동점·못 미침)는 이 값과 견준다
  const [previous, setPrevious] = useState<number | null>(null);
  // [그만하기]로 안내에 돌아왔으면 [시작하기]에 포커스를 준다
  const [returned, setReturned] = useState(false);

  // 다른 탭에서 바뀐 기록도 열 때 한 번 다시 읽는다
  useEffect(() => {
    useMiniRecords.getState().reload();
  }, []);

  // 이 화면에서는 친 드럼이 울린다(자유 연습과 같은 공용 경로). 소리 크기가 세기를 따르므로 친 만큼 들린다
  useEffect(() => {
    setSoundOnHit(true);
    return () => setSoundOnHit(false);
  }, []);

  // 타격 구독: 카운트다운부터 걸어 두어 플레이가 시작되는 순간의 타격을 놓치지 않는다. 타수로 받을지는 아래에서 시각으로 가린다
  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'playing') return;
    return useLive.subscribe((s, prev) => {
      const hit = s.lastHit;
      if (s.hitSeq === prev.hitSeq || !hit) return;
      setHits((list) => (list.some((h) => h.id === hit.id) ? list : [...list, hit]));
      if (phase !== 'playing') return;
      if (isWrongPad(hit)) setWrongSeq((n) => n + 1);
      else if (hit.pad === VELOCITY_PAD) setWrongSeq(0);
    });
  }, [phase]);

  // 다른 패드 안내는 잠깐만 보인다. 그사이 또 치면 시간을 다시 잰다
  useEffect(() => {
    if (wrongSeq === 0) return;
    const timer = setTimeout(() => setWrongSeq(0), WRONG_PAD_HINT_MS);
    return () => clearTimeout(timer);
  }, [wrongSeq]);

  const feel = startedAt === null ? [] : collectFeel(startedAt, hits);
  const feelDone = feel.length >= DYNAMICS_SHOTS;
  const shots = matchAt === null ? [] : collectMatch(matchAt, hits, targets);
  const done = shots.length >= DYNAMICS_SHOTS;
  const step = dynamicsStep(feel.length, matchAt);
  // 내 세기 세 값을 한 글자열로. 세 타를 받은 뒤에는 바뀌지 않아, 아래 타이머가 그사이의 타격으로 다시 걸리지 않는다
  const feelKey = feel.map((shot) => shot.actual).join(',');

  // 감 잡기를 다 치면 「내 세기」를 잠깐 보인 뒤 숫자 맞추기를 저절로 시작한다. 목표는 그때 내 세기 범위에서 뽑는다
  useEffect(() => {
    if (phase !== 'playing' || !feelDone || matchAt !== null) return;
    const timer = setTimeout(() => {
      setTargets(makeMatchTargets(feelKey.split(',').map(Number), Math.random));
      setWrongSeq(0);
      setMatchAt(performance.now());
    }, FEEL_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [phase, feelDone, matchAt, feelKey]);

  // 숫자 맞추기의 3타째를 받으면 끝을 알린다(제한 시간이 없는 게임이라 화면이 알린다)
  useEffect(() => {
    if (phase === 'playing' && done) finish();
  }, [phase, done, finish]);

  // 결과가 확정될 때만 기록을 쓴다(중간에 나간 판은 남지 않는다). 숫자 맞추기 세 타를 다 친 판만 남긴다.
  // 같은 값으로 다시 불려도 동점은 갱신이 아니라서 저장 값이 바뀌지 않는다
  useEffect(() => {
    if (phase !== 'result' || startedAt === null || matchAt === null) return;
    const feelFinal = collectFeel(startedAt, hits);
    const final = collectMatch(matchAt, hits, targets);
    if (feelFinal.length < DYNAMICS_SHOTS || final.length < DYNAMICS_SHOTS) return;
    useMiniRecords.getState().submit({
      gameId: 'dynamics',
      score: matchScore(final),
      at: new Date().toISOString(),
      detail: {
        feel: feelFinal.map((shot) => shot.actual),
        shots: final.map(({ target, actual }) => ({ target, actual })),
      },
    });
  }, [phase, startedAt, matchAt, hits, targets]);

  /** 새 판 준비: 받은 타격·내 세기·목표를 비우고, 지금의 최고 기록을 견줄 값으로 잡는다. 언제나 감 잡기부터 시작한다(D10) */
  const begin = () => {
    setHits([]);
    setMatchAt(null);
    setTargets([]);
    setWrongSeq(0);
    setPrevious(useMiniRecords.getState().best('dynamics')?.score ?? null);
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
    setHits([]);
    setMatchAt(null);
    setTargets([]);
    setWrongSeq(0);
    setReturned(true);
    flow.quit();
  };

  if (phase === 'intro') {
    return (
      <main className="main">
        <MiniIntro
          overline={GAME_NAME}
          title={['내 세기를 재고', '숫자에 맞춰 치세요.']}
          description="먼저 약·중·강을 한 번씩 쳐서 내 세기를 재요. 그다음 숫자 세 개에 맞춰 칩니다."
          art={<DynamicsArt size="hero" />}
          cells={[
            { label: '한 판', value: `${DYNAMICS_SHOTS}+${DYNAMICS_SHOTS}`, unit: '타', note: '재기 3타, 맞추기 3타' },
            { label: '치는 곳', value: '스네어', note: '스틱으로 친 것만 받아요' },
            best === null
              ? { label: '내 최고 기록', value: '—', note: '이 브라우저에 저장돼요' }
              : { label: '내 최고 기록', value: formatDynamicsScore(best), note: '낮을수록 좋아요' },
          ]}
          stickConnected={ready}
          blocked={ready ? undefined : '세기를 재야 해서 스틱이 있어야 해요. 스틱을 연결해 주세요.'}
          focusStart={returned}
          onStart={onStart}
        />
      </main>
    );
  }

  if (phase === 'result') {
    const score = matchScore(shots);
    const note = bestNote(score, previous);
    const worst = worstShot(shots);
    return (
      <main className="main">
        <div className="mini-page">
          <MiniResultHero
            overline={GAME_NAME}
            newBest={note.newBest}
            title={[`${formatDynamicsScore(score)}.`, roundRemark(shots)]}
            score={{ label: '오차 합', value: String(score), note: note.text }}
            onRetry={onRetry}
          />
          <DynamicsResult
            feel={feel}
            shots={shots}
            highlight={worst !== null && worst.diff !== 0 ? shots.indexOf(worst) : undefined}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <DynamicsStage
        phase={phase}
        countdown={flow.countdown}
        step={step}
        feel={feel}
        targets={targets}
        shots={shots}
        wrongPad={wrongSeq > 0 && phase === 'playing' && step !== 'review'}
        onQuit={onQuit}
      />
    </main>
  );
}
