// 「인간 메트로놈」 화면 (설계 MODE-006-minigame-tempo 4절 「한 판」). 예비 박 8개를 듣고, 소리가 꺼진 뒤 같은 빠르기로 16타를 쳐서 박에서 벗어난 정도(평균 오차)를 겨룬다.
// 단계(useMiniFlow)에 따라 안내 · 플레이(카운트다운·예비 박·측정·마무리는 같은 TempoStage) · 결과를 조립한다.
// 예비 박은 예약기(tempoCountIn)가 직접 울린다(전역 메트로놈을 켜지 않는다). 오차 계산은 domain/tempoRound, 저장은 store가 한다.
// 타격은 플레이 단계 내내 받은 순서대로 담아 두고, 셀지는 시각으로 가린다: 측정 시작(마지막 예비 박 + 반 박) 뒤의 타격만 센다.
// 그래서 예비 박에 맞춰 같이 치던 타격은 세지 않고, 측정으로 넘어가는 순간의 타격은 놓치지 않는다.
import { useEffect, useState } from 'react';
import { useShell } from '@/components/shell/nav/useShell';
import type { PadId } from '@/domain/kit/pads';
import { metronome } from '@/engine/Metronome';
import { MiniIntro } from '@/features/mini/components/MiniIntro';
import { MiniResultHero } from '@/features/mini/components/MiniResultHero';
import type { StatCell } from '@/features/mini/components/StatCells';
import { TempoArt } from '@/features/mini/components/tempo/TempoArt';
import { TempoResult } from '@/features/mini/components/tempo/TempoResult';
import { TempoStage } from '@/features/mini/components/tempo/TempoStage';
import { hitTime } from '@/features/mini/domain/hitTime';
import {
  COUNT_IN_BEATS,
  COUNT_IN_LEAD_MS,
  IDLE_LIMIT_MS,
  TEMPO_BPMS,
  TEMPO_CLOSING_MS,
  TEMPO_HITS,
  averageErrorMs,
  chartScaleMs,
  collectTempoHits,
  endBpm,
  flowCell,
  formatBpm,
  measureStartAt,
  pickBpm,
  tempoBestNote,
  tempoFlow,
  tempoResultTitle,
  worstHit,
  type TempoHit,
} from '@/features/mini/domain/tempoRound';
import { formatError } from '@/features/mini/domain/timingError';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { startCountIn } from '@/features/mini/tempoCountIn';
import { useMiniFlow } from '@/features/mini/useMiniFlow';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { useLive } from '@/store/liveStore';
import './mini.css';

const GAME_NAME = '인간 메트로놈';

/** 그 판에 받은 타격 하나. `at`은 집계에 쓸 타격 시각(domain/hitTime) */
interface RawHit {
  id: number;
  pad: PadId | null;
  at: number;
}

/** 결과의 칸 3개: 가장 벗어난 타 · 끝날 때 빠르기 · 흐름 */
function resultCells(hits: readonly TempoHit[], bpm: number): StatCell[] {
  const worst = worstHit(hits);
  const end = endBpm(hits);
  const flow = flowCell(tempoFlow(hits));
  return [
    worst === null
      ? { label: '가장 벗어난 타', value: '—' }
      : { label: '가장 벗어난 타', value: String(worst.index), unit: '번째', note: formatError(worst.errorMs) },
    end === null
      ? { label: '끝날 때 빠르기', value: '—', note: `제시한 빠르기 ${bpm}` }
      : { label: '끝날 때 빠르기', value: formatBpm(end), unit: 'BPM', note: `제시한 빠르기 ${bpm}` },
    { label: '흐름', value: flow.value, note: flow.note },
  ];
}

export function TempoGamePage() {
  useShell({ title: '미니게임' });
  const flow = useMiniFlow({ closingMs: TEMPO_CLOSING_MS });
  const { phase, startedAt, finish, quit } = flow;
  const bestRecord = useMiniRecords((s) => s.best('tempo'));
  const stickConnected = useLive((s) => s.connected[0] || s.connected[1]);
  // 이번 판의 빠르기. 판이 끝나도 남겨 두어 다음 판이 같은 값을 고르지 않게 한다
  const [bpm, setBpm] = useState<number | null>(null);
  // 울린 예비 박 수(화면의 박 점)
  const [beats, setBeats] = useState(0);
  // 측정을 시작하는 시각(마지막 예비 박 + 반 박). 예비 박이 울리는 동안은 null
  const [measureFrom, setMeasureFrom] = useState<number | null>(null);
  // 이 판의 플레이 단계에 받은 타격. 받은 순서대로, 같은 타격은 id로 한 번만 담는다
  const [raw, setRaw] = useState<readonly RawHit[]>([]);
  // 예비 박을 예약하지 못했다(오디오가 꺼져 있음). 안내에 그 사실을 보인다
  const [audioFailed, setAudioFailed] = useState(false);
  // 이 판을 시작할 때의 최고 기록. 결과 문구(갱신·동점·못 미침)는 이 값과 견준다
  const [previous, setPrevious] = useState<number | null>(null);
  // [그만하기]나 시작 실패로 안내에 돌아왔으면 [시작하기]에 포커스를 준다
  const [returned, setReturned] = useState(false);

  // 다른 탭에서 바뀐 기록도 열 때 한 번 다시 읽는다
  useEffect(() => {
    useMiniRecords.getState().reload();
  }, []);

  // 박을 알려 주는 것은 모두 끈다(D8): 열릴 때 전역 메트로놈이 울리고 있으면 멈춘다. 곡 연주에 묶인 클릭은 건드리지 않는다
  useEffect(() => {
    const met = useLive.getState().metronome;
    if (met.playing && !met.locked) metronome.stop();
  }, []);

  // 이 화면에서는 친 드럼이 울린다(자유 연습과 같은 공용 경로). 화면이 따로 소리를 내지 않는다
  useEffect(() => {
    setSoundOnHit(true);
    return () => setSoundOnHit(false);
  }, []);

  // 키보드 드럼은 치는 단계에서만 켠다. 안내·마무리·결과에서는 꺼져 있어 Space·Enter로 버튼을 누를 수 있다
  useKeyboardDrum(phase === 'countdown' || phase === 'playing');

  // 예비 박: 플레이가 시작되고 잠깐 뒤부터 8번 울린다. 끝나면 측정 시작 시각이 정해진다.
  // 첫 박을 예약하지 못하면(오디오가 꺼져 있음) 그 판을 버리고 안내로 돌아간다
  useEffect(() => {
    if (phase !== 'playing' || startedAt === null || bpm === null) return;
    const countIn = startCountIn({
      bpm,
      beats: COUNT_IN_BEATS,
      firstAt: startedAt + COUNT_IN_LEAD_MS,
      onBeat: (index) => setBeats(index + 1),
      onEnd: (lastBeatAt) => setMeasureFrom(measureStartAt(lastBeatAt, bpm)),
      onFail: () => {
        setAudioFailed(true);
        setReturned(true);
        quit();
      },
    });
    return () => countIn.cancel();
  }, [phase, startedAt, bpm, quit]);

  // 타격 구독: 플레이 단계 내내 담아 둔다(예비 박 중 타격은 아래에서 시각으로 걸러진다). 마무리 중 타격은 받지 않는다
  useEffect(() => {
    if (phase !== 'playing') return;
    return useLive.subscribe((s, prev) => {
      const hit = s.lastHit;
      if (s.hitSeq === prev.hitSeq || !hit) return;
      setRaw((list) => (list.some((h) => h.id === hit.id) ? list : [...list, { id: hit.id, pad: hit.pad, at: hitTime(hit) }]));
    });
  }, [phase]);

  const hits = bpm === null ? [] : collectTempoHits(measureFrom, raw, bpm);
  const count = hits.length;
  const done = count >= TEMPO_HITS;

  // 16번째 타를 세면 끝을 알린다(제한 시간이 없는 게임이라 화면이 알린다)
  useEffect(() => {
    if (phase === 'playing' && done) finish();
  }, [phase, done, finish]);

  // 측정 중 한동안 센 타격이 없으면 판을 끝낸다(스틱이 끊기거나 자리를 비워도 판이 끝난다). 타격을 셀 때마다 다시 잰다
  useEffect(() => {
    if (phase !== 'playing' || measureFrom === null || done) return;
    const timer = setTimeout(() => finish(), IDLE_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [phase, measureFrom, count, done, finish]);

  // 결과가 확정될 때만 기록을 쓴다(중간에 나간 판은 남지 않는다). 16타를 채우지 못한 판은 남기지 않는다.
  // 같은 점수로 다시 불려도 동점은 갱신이 아니라서 저장 값이 바뀌지 않는다
  useEffect(() => {
    if (phase !== 'result' || bpm === null) return;
    const counted = collectTempoHits(measureFrom, raw, bpm);
    const average = averageErrorMs(counted);
    if (counted.length < TEMPO_HITS || average === null) return;
    useMiniRecords.getState().submit({
      gameId: 'tempo',
      score: average,
      at: new Date().toISOString(),
      detail: { bpm, errors: counted.map((hit) => hit.errorMs) },
    });
  }, [phase, bpm, measureFrom, raw]);

  /** 그 판의 진행 값을 비운다(빠르기는 남긴다) */
  const clearRound = () => {
    setBeats(0);
    setMeasureFrom(null);
    setRaw([]);
  };
  /** 새 판 준비: 직전과 다른 빠르기를 뽑고, 지금의 최고 기록을 견줄 값으로 잡는다 */
  const begin = () => {
    setBpm(pickBpm(bpm, Math.random));
    clearRound();
    setAudioFailed(false);
    setPrevious(useMiniRecords.getState().best('tempo')?.score ?? null);
  };
  const onStart = () => {
    // 잠금을 풀지 못하면 첫 예비 박을 예약할 때 드러난다(그때 안내로 돌아가 알린다)
    void unlockAudio().catch(() => undefined);
    begin();
    flow.start();
  };
  const onRetry = () => {
    begin();
    flow.retry();
  };
  const onQuit = () => {
    clearRound();
    setReturned(true);
    quit();
  };

  if (phase === 'intro') {
    const best = bestRecord !== null && bestRecord.gameId === 'tempo' ? bestRecord : null;
    return (
      <main className="main">
        <MiniIntro
          overline={GAME_NAME}
          title={['소리가 꺼져도', '같은 빠르기로 치세요.']}
          description={`예비 박 ${COUNT_IN_BEATS}개를 듣고, 소리가 꺼지면 같은 빠르기로 ${TEMPO_HITS}번 치세요. 어느 패드를 쳐도 돼요.`}
          art={<TempoArt size="hero" />}
          cells={[
            { label: '한 판', value: String(TEMPO_HITS), unit: '타', note: `예비 박 ${COUNT_IN_BEATS}개 뒤에 시작해요` },
            { label: '재는 것', value: '평균 오차', note: '첫 타격부터 박에서 벗어난 정도예요' },
            best === null
              ? { label: '내 최고 기록', value: '—', note: '이 브라우저에 저장돼요' }
              : { label: '내 최고 기록', value: String(best.score), unit: 'ms', note: `${best.detail.bpm} BPM에서 세웠어요` },
          ]}
          stickConnected={stickConnected}
          note={audioFailed ? '소리를 켜지 못해 시작하지 못했어요. 브라우저의 소리 설정을 확인해 주세요.' : '빠르기는 판마다 달라져요.'}
          focusStart={returned}
          onStart={onStart}
        />
      </main>
    );
  }

  // 여기부터는 빠르기가 정해져 있다(시작할 때 뽑는다)
  const shownBpm = bpm ?? TEMPO_BPMS[0];

  if (phase === 'result') {
    const average = averageErrorMs(hits);
    // 16타를 채우지 못한 판은 기록도 견줄 값도 없고, 머리만 보인다
    const note = done && average !== null ? tempoBestNote(average, previous) : null;
    return (
      <main className="main">
        <div className="mini-page">
          <MiniResultHero
            overline={`${GAME_NAME} · ${shownBpm} BPM`}
            newBest={note?.newBest ?? false}
            title={tempoResultTitle(hits)}
            score={
              note === null || average === null
                ? { label: '평균 오차', value: '—' }
                : { label: '평균 오차', value: String(average), unit: 'ms', note: note.text }
            }
            onRetry={onRetry}
          />
          {note === null ? null : (
            <TempoResult cells={resultCells(hits, shownBpm)} errors={hits.map((hit) => hit.errorMs)} scaleMs={chartScaleMs(hits)} />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <TempoStage
        phase={phase}
        countdown={flow.countdown}
        bpm={shownBpm}
        step={measureFrom === null ? 'listen' : 'measure'}
        beats={beats}
        hits={count}
        onQuit={onQuit}
      />
    </main>
  );
}
