// 「누구보다 빠르게」 화면 (설계 MODE-006-minigame-speed 4절 「한 판」). 10초 동안 스네어를 친 횟수를 센다.
// 단계(useMiniFlow)에 따라 안내 · 플레이(카운트다운·플레이·마무리는 같은 SpeedStage) · 결과를 조립한다. 집계 계산은 domain/speedRound, 저장은 store가 한다.
// 소리·텔레메트리는 자유 연습·학습 코스처럼 공용 경로(setSoundOnHit)가 내고, 이 화면은 타격만 구독한다.
// 타격은 단계가 아니라 시각으로 가린다: 그 판에 받은 스네어 타격을 모두 담아 두고, 시작 시각이 정해지면 구간 안의 것만 센다.
// 그래서 카운트다운 중에 친 타격은 세지 않고, 끝나기 직전에 쳐서 마무리 시간(250ms)에 늦게 도착한 타격은 센다.
import { useEffect, useState } from 'react';
import { useShell } from '@/components/shell/nav/useShell';
import type { ResolvedHit } from '@/domain/events';
import { MiniIntro } from '@/features/mini/components/MiniIntro';
import { MiniResultHero } from '@/features/mini/components/MiniResultHero';
import { miniGameInfo } from '@/features/mini/domain/miniCatalog';
import type { StatCell } from '@/features/mini/components/StatCells';
import { SpeedArt } from '@/features/mini/components/speed/SpeedArt';
import { SpeedResult } from '@/features/mini/components/speed/SpeedResult';
import { SpeedStage } from '@/features/mini/components/speed/SpeedStage';
import {
  GO_SHOW_MS,
  LATE_GRACE_MS,
  SPEED_DURATION_MS,
  SPEED_PAD,
  acceptedOffsets,
  currentRate,
  hitsPerSecond,
  peakSecond,
  secondBuckets,
  speedResultTitle,
  speedVerdict,
} from '@/features/mini/domain/speedRound';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { useMiniFlow } from '@/features/mini/useMiniFlow';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { useLive } from '@/store/liveStore';
import './mini.css';

const GAME_NAME = '누구보다 빠르게';
/** 남은 시간 숫자와 「지금 속도」를 갱신하는 간격 */
const TICK_MS = 100;

/** 결과의 셋째 칸: 이 판 전의 최고 기록과 견준 한 줄 */
function bestCell(score: number, previous: number | null): StatCell {
  const before = previous ?? 0;
  switch (speedVerdict(score, previous)) {
    case 'best':
      return { label: '지난 최고', value: String(before), unit: '타', note: `이번에 ${score - before}타 넘었어요` };
    case 'first':
      return { label: '내 최고 기록', value: String(score), unit: '타', note: '이번이 첫 기록이에요' };
    case 'tie':
      return { label: '내 최고 기록', value: String(before), unit: '타', note: '이번 기록과 같아요' };
    case 'short':
      return { label: '내 최고 기록', value: String(before), unit: '타', note: `${before - score}타 모자랐어요` };
    default:
      return previous === null ? { label: '내 최고 기록', value: '—' } : { label: '내 최고 기록', value: String(previous), unit: '타' };
  }
}

export function SpeedGamePage() {
  useShell({ title: '미니게임' });
  const flow = useMiniFlow({ playMs: SPEED_DURATION_MS, closingMs: LATE_GRACE_MS });
  const { phase, startedAt } = flow;
  const best = useMiniRecords((s) => s.best('speed')?.score ?? null);
  const stickConnected = useLive((s) => s.connected[0] || s.connected[1]);
  // 이 판(카운트다운부터 마무리까지)에 받은 스네어 타격. 같은 타격은 id로 한 번만 담는다
  const [hits, setHits] = useState<readonly ResolvedHit[]>([]);
  // 시작부터 흐른 시간(ms). 플레이 단계에서 TICK_MS마다 갱신한다
  const [elapsed, setElapsed] = useState(0);
  // 이 판을 시작할 때의 최고 기록. 결과 문구(갱신·동점·못 미침)는 이 값과 견준다
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

  // 타격 구독: 카운트다운부터 걸어 두어 플레이가 시작되는 순간의 타격을 놓치지 않는다. 셀지는 아래에서 시각으로 가린다
  const collecting = phase === 'countdown' || phase === 'playing' || phase === 'closing';
  useEffect(() => {
    if (!collecting) return;
    return useLive.subscribe((s, prev) => {
      const hit = s.lastHit;
      if (s.hitSeq === prev.hitSeq || !hit || hit.pad !== SPEED_PAD) return;
      setHits((list) => (list.some((h) => h.id === hit.id) ? list : [...list, hit]));
    });
  }, [collecting]);

  // 남은 시간 숫자와 「지금 속도」. 시각은 performance.now()에서 다시 계산하므로 탭이 잠시 가려져도 어긋나지 않는다
  useEffect(() => {
    if (phase !== 'playing' || startedAt === null) return;
    const timer = setInterval(() => setElapsed(performance.now() - startedAt), TICK_MS);
    return () => clearInterval(timer);
  }, [phase, startedAt]);

  const offsets = startedAt === null ? [] : acceptedOffsets(startedAt, hits);
  const count = offsets.length;
  const perSecond = secondBuckets(offsets);

  // 결과가 확정될 때만 기록을 쓴다(중간에 나간 판은 남지 않는다). 0타면 남기지 않는다.
  // 같은 점수로 다시 불려도 동점은 갱신이 아니라서 저장 값이 바뀌지 않는다
  useEffect(() => {
    if (phase !== 'result' || startedAt === null) return;
    const accepted = acceptedOffsets(startedAt, hits);
    if (accepted.length === 0) return;
    useMiniRecords.getState().submit({
      gameId: 'speed',
      score: accepted.length,
      at: new Date().toISOString(),
      detail: { perSecond: secondBuckets(accepted) },
    });
  }, [phase, startedAt, hits]);

  /** 새 판 준비: 받은 타격을 비우고 지금의 최고 기록을 견줄 값으로 잡는다 */
  const begin = () => {
    setHits([]);
    setElapsed(0);
    setPrevious(useMiniRecords.getState().best('speed')?.score ?? null);
  };
  const onStart = () => {
    // 오디오 잠금을 풀지 못해도 소리 없이 진행한다(집계는 소리와 무관하다)
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
    setElapsed(0);
    setReturned(true);
    flow.quit();
  };

  if (phase === 'intro') {
    return (
      <main className="main">
        <MiniIntro
          overline={GAME_NAME}
          title={['10초 동안 스네어를', '가장 많이 치세요.']}
          description={miniGameInfo('speed').description}
          art={<SpeedArt size="hero" />}
          cells={[
            { label: '제한 시간', value: String(SPEED_DURATION_MS / 1000), unit: '초', note: '끝나면 자동으로 멈춰요' },
            { label: '세는 것', value: '스네어', note: '양손 번갈아 쳐도 됩니다' },
            best === null
              ? { label: '내 최고 기록', value: '—', note: '이 브라우저에 저장돼요' }
              : { label: '내 최고 기록', value: String(best), unit: '타', note: '이 브라우저에 저장돼요' },
          ]}
          stickConnected={stickConnected}
          focusStart={returned}
          onStart={onStart}
        />
      </main>
    );
  }

  if (phase === 'result') {
    const peak = peakSecond(perSecond);
    const verdict = speedVerdict(count, previous);
    return (
      <main className="main">
        <div className="mini-page">
          <MiniResultHero
            overline={GAME_NAME}
            newBest={verdict === 'first' || verdict === 'best'}
            title={speedResultTitle(count, previous)}
            score={{ label: '기록', value: String(count), unit: '타', note: `초당 ${hitsPerSecond(count)}타` }}
            onRetry={onRetry}
          />
          <SpeedResult
            cells={[
              { label: '초당 평균', value: String(hitsPerSecond(count)), unit: '타', note: '10초 전체' },
              count > 0
                ? { label: '가장 빨랐던 1초', value: String(peak.count), unit: '타', note: `${peak.second}초째` }
                : { label: '가장 빨랐던 1초', value: '0', unit: '타' },
              bestCell(count, previous),
            ]}
            perSecond={perSecond}
            highlight={count > 0 ? peak.second - 1 : undefined}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <SpeedStage
        phase={phase}
        countdown={flow.countdown}
        showGo={phase === 'playing' && elapsed < GO_SHOW_MS}
        remainingMs={phase === 'countdown' ? SPEED_DURATION_MS : phase === 'playing' ? Math.max(0, SPEED_DURATION_MS - elapsed) : 0}
        count={count}
        rate={currentRate(offsets, elapsed)}
        perSecond={perSecond}
        best={best}
        onQuit={onQuit}
      />
    </main>
  );
}
