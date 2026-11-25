// 「어디까지 올라가는 거예요?」 화면 (설계 MODE-006-minigame-crescendo 4절 「한 판」). 약하게 시작해서 칠 때마다 앞 타격보다 세게 쳐야 이어지고, 몇 번 이어 갔는지가 기록이다.
// 단계(useMiniFlow)에 따라 안내 · 플레이(카운트다운·플레이·마무리는 같은 CrescendoStage) · 결과를 조립한다. 판정은 domain/crescendoRound, 저장은 store가 한다.
// 제한 시간이 없다. 앞 타격보다 세지 않게 치거나 127에 닿으면 화면이 흐름 훅에 끝을 알리고, 마무리(1.5초) 동안 끝낸 타격을 보인 뒤 결과로 간다.
// 타격은 그 판에 받은 것을 받은 순서대로 담아 두고, 계단에 넣을지는 시각과 세기로 가린다(카운트다운 중·보호 시간 안의 타격은 빠진다).
// 키보드 드럼은 켜지 않는다 — 키보드는 세기가 고정이라 받지 않고, 꺼 두면 어느 단계에서든 Space·Enter로 버튼을 누를 수 있다.
import { useEffect, useState } from 'react';
import { useShell } from '@/components/shell/nav/useShell';
import type { ResolvedHit } from '@/domain/events';
import { MiniIntro } from '@/features/mini/components/MiniIntro';
import { MiniResultHero } from '@/features/mini/components/MiniResultHero';
import { CrescendoArt } from '@/features/mini/components/crescendo/CrescendoArt';
import { CrescendoResult } from '@/features/mini/components/crescendo/CrescendoResult';
import { CrescendoStage } from '@/features/mini/components/crescendo/CrescendoStage';
import { miniGameInfo } from '@/features/mini/domain/miniCatalog';
import { CRESCENDO_CLOSING_MS, bestNote, collectRun, runRemark, runScore, type CrescendoRun } from '@/features/mini/domain/crescendoRound';
import { VELOCITY_PAD, WRONG_PAD_HINT_MS, canStartVelocityGame, isWrongPad } from '@/features/mini/domain/velocityShot';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { useMiniFlow } from '@/features/mini/useMiniFlow';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import './mini.css';

const GAME_NAME = '어디까지 올라가는 거예요?';

export function CrescendoGamePage() {
  useShell({ title: '미니게임' });
  const flow = useMiniFlow({ closingMs: CRESCENDO_CLOSING_MS });
  const { phase, startedAt, finish } = flow;
  const best = useMiniRecords((s) => s.best('crescendo')?.score ?? null);
  const sensorKind = useSettings((s) => s.sensorKind);
  const connected = useLive((s) => s.connected);
  // 세기를 재는 입력이 준비됐는가. 자유 연습·상단 연결 표시와 같은 판정이다
  const hasUsageGuide = sensorKind !== 'none' && !!sensorRegistry.get(sensorKind)?.usageGuide;
  const ready = canStartVelocityGame(sensorKind, hasUsageGuide, connected);
  // 이 판(카운트다운부터 끝낸 타격까지)에 받은 타격. 받은 순서대로, 같은 타격은 id로 한 번만 담는다
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

  // 타격 구독: 카운트다운부터 걸어 두어 플레이가 시작되는 순간의 타격을 놓치지 않는다. 계단에 넣을지는 아래에서 시각으로 가린다
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

  const run: CrescendoRun = startedAt === null ? { steps: [], end: null, last: null } : collectRun(startedAt, hits);
  const ended = run.end !== null;

  // 앞 타격보다 세지 않게 쳤거나 꼭대기에 닿으면 끝을 알린다(제한 시간이 없는 게임이라 화면이 알린다)
  useEffect(() => {
    if (phase === 'playing' && ended) finish();
  }, [phase, ended, finish]);

  // 결과가 확정될 때만 기록을 쓴다(중간에 나간 판은 남지 않는다).
  // 같은 값으로 다시 불려도 동점은 갱신이 아니라서 저장 값이 바뀌지 않는다
  useEffect(() => {
    if (phase !== 'result' || startedAt === null) return;
    const final = collectRun(startedAt, hits);
    if (final.end === null || final.steps.length === 0) return;
    useMiniRecords.getState().submit({
      gameId: 'crescendo',
      score: runScore(final),
      at: new Date().toISOString(),
      detail: { steps: final.steps, last: final.last },
    });
  }, [phase, startedAt, hits]);

  /** 새 판 준비: 받은 타격을 비우고, 지금의 최고 기록을 견줄 값으로 잡는다 */
  const begin = () => {
    setHits([]);
    setWrongSeq(0);
    setPrevious(useMiniRecords.getState().best('crescendo')?.score ?? null);
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
    setWrongSeq(0);
    setReturned(true);
    flow.quit();
  };

  if (phase === 'intro') {
    return (
      <main className="main">
        <MiniIntro
          overline={GAME_NAME}
          title={['약하게 시작해서', '칠 때마다 더 세게.']}
          description={miniGameInfo('crescendo').description}
          art={<CrescendoArt size="hero" />}
          cells={[
            { label: '규칙', value: '점점 세게', note: '같거나 약하면 끝' },
            { label: '치는 곳', value: '스네어', note: '스틱으로 친 것만 받아요' },
            best === null
              ? { label: '내 최고 기록', value: '—', note: '이 브라우저에 저장돼요' }
              : { label: '내 최고 기록', value: String(best), unit: '번', note: '이 브라우저에 저장돼요' },
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
    const score = runScore(run);
    const note = bestNote(score, previous);
    return (
      <main className="main">
        <div className="mini-page">
          <MiniResultHero
            overline={GAME_NAME}
            newBest={note.newBest}
            title={[`${score}번.`, runRemark(run)]}
            score={{ label: '이어 간 횟수', value: String(score), unit: '번', note: note.text }}
            onRetry={onRetry}
          />
          <CrescendoResult run={run} />
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <CrescendoStage
        phase={phase}
        countdown={flow.countdown}
        run={run}
        wrongPad={wrongSeq > 0 && phase === 'playing' && !ended}
        onQuit={onQuit}
      />
    </main>
  );
}
