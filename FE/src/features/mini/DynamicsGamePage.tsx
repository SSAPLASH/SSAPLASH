// 「강약중강약」 화면 (설계 MODE-006-minigame-dynamics 4절 「한 판」). 강·약·중 세 번을 제시한 세기에 맞춰 치고 점수를 낸다.
// 단계(useMiniFlow)에 따라 안내 · 플레이(카운트다운·플레이·마무리는 같은 DynamicsStage) · 결과를 조립한다. 점수 계산은 domain/dynamicsRound, 저장은 store가 한다.
// 제한 시간이 없다. 3타째를 받으면 화면이 흐름 훅에 끝을 알리고, 마무리(1.2초) 동안 세 번째 결과를 보인 뒤 결과로 간다.
// 타격은 그 판에 받은 것을 받은 순서대로 담아 두고, 타수로 받을지는 시각으로 가린다(카운트다운 중 타격과 보호 시간 안의 타격은 빠진다).
// 키보드 드럼은 켜지 않는다 — 키보드는 세기가 고정이라 받지 않고, 꺼 두면 어느 단계에서든 Space·Enter로 버튼을 누를 수 있다(D11).
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
  DYNAMICS_PAD,
  DYNAMICS_SHOTS,
  WRONG_PAD_HINT_MS,
  bestNote,
  canStartDynamics,
  collectShots,
  isWrongPad,
  makeTargets,
  roundRemark,
  roundScore,
  worstShot,
  type DynamicsTarget,
} from '@/features/mini/domain/dynamicsRound';
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
  const ready = canStartDynamics(sensorKind, hasUsageGuide, connected);
  // 이 판의 목표 3개. 시작·다시 하기 때 새로 뽑는다
  const [targets, setTargets] = useState<readonly DynamicsTarget[]>([]);
  // 이 판(카운트다운부터 3타째까지)에 받은 타격. 받은 순서대로, 같은 타격은 id로 한 번만 담는다
  const [hits, setHits] = useState<readonly ResolvedHit[]>([]);
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
      else if (hit.pad === DYNAMICS_PAD) setWrongSeq(0);
    });
  }, [phase]);

  // 다른 패드 안내는 잠깐만 보인다. 그사이 또 치면 시간을 다시 잰다
  useEffect(() => {
    if (wrongSeq === 0) return;
    const timer = setTimeout(() => setWrongSeq(0), WRONG_PAD_HINT_MS);
    return () => clearTimeout(timer);
  }, [wrongSeq]);

  const shots = startedAt === null ? [] : collectShots(startedAt, hits, targets);
  const done = shots.length >= DYNAMICS_SHOTS;

  // 3타째를 받으면 끝을 알린다(제한 시간이 없는 게임이라 화면이 알린다)
  useEffect(() => {
    if (phase === 'playing' && done) finish();
  }, [phase, done, finish]);

  // 결과가 확정될 때만 기록을 쓴다(중간에 나간 판은 남지 않는다). 세 타를 다 친 판만 남긴다.
  // 같은 점수로 다시 불려도 동점은 갱신이 아니라서 저장 값이 바뀌지 않는다
  useEffect(() => {
    if (phase !== 'result' || startedAt === null) return;
    const final = collectShots(startedAt, hits, targets);
    if (final.length < DYNAMICS_SHOTS) return;
    useMiniRecords.getState().submit({
      gameId: 'dynamics',
      score: roundScore(final),
      at: new Date().toISOString(),
      detail: { shots: final.map(({ level, target, actual }) => ({ level, target, actual })) },
    });
  }, [phase, startedAt, hits, targets]);

  /** 새 판 준비: 목표를 새로 뽑고, 받은 타격을 비우고, 지금의 최고 기록을 견줄 값으로 잡는다 */
  const begin = () => {
    setTargets(makeTargets(Math.random));
    setHits([]);
    setWrongSeq(0);
    setPrevious(useMiniRecords.getState().best('dynamics')?.score ?? null);
  };
  const onStart = () => {
    // 오디오 잠금을 풀지 못해도 소리 없이 진행한다(점수는 소리와 무관하다)
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
    setWrongSeq(0);
    setReturned(true);
    flow.quit();
  };

  if (phase === 'intro') {
    return (
      <main className="main">
        <MiniIntro
          overline={GAME_NAME}
          title={['세 번의 타격을', '제시한 세기에 맞추세요.']}
          description="강·약·중이 한 번씩 나와요. 순서와 목표는 판마다 달라요."
          art={<DynamicsArt size="hero" />}
          cells={[
            { label: '한 판', value: String(DYNAMICS_SHOTS), unit: '타', note: '강·약·중 한 번씩' },
            { label: '치는 곳', value: '스네어', note: '스틱으로 친 것만 받아요' },
            best === null
              ? { label: '내 최고 기록', value: '—', note: '이 브라우저에 저장돼요' }
              : { label: '내 최고 기록', value: String(best), unit: '점', note: '이 브라우저에 저장돼요' },
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
    const score = roundScore(shots);
    const note = bestNote(score, previous);
    const worst = worstShot(shots);
    return (
      <main className="main">
        <div className="mini-page">
          <MiniResultHero
            overline={GAME_NAME}
            newBest={note.newBest}
            title={[`${score}점.`, roundRemark(shots)]}
            score={{ label: '점수', value: String(score), unit: '점', note: note.text }}
            onRetry={onRetry}
          />
          <DynamicsResult shots={shots} highlight={worst !== null && worst.diff !== 0 ? shots.indexOf(worst) : undefined} />
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <DynamicsStage
        phase={phase}
        countdown={flow.countdown}
        targets={targets}
        shots={shots}
        wrongPad={wrongSeq > 0 && phase === 'playing'}
        onQuit={onQuit}
      />
    </main>
  );
}
