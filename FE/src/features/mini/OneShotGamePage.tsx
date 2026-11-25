// 「정적 뒤 한 방」 화면 (설계 MODE-006-minigame-oneshot 4절 「한 판」). 노래가 끊긴 정적 뒤, 드럼이 돌아올 자리에 한 타를 맞힌다.
// 이벤트 스위치(config/miniOneShot)가 켜진 빌드에만 있다. 음원은 저장소에 없고 안내 단계에서 받아 둔다.
// 단계(useMiniFlow)에 따라 안내 · 플레이(카운트다운·노래·정적·판정은 같은 OneShotStage) · 결과를 조립한다.
// 판정 계산은 domain/oneShotRound, 소리는 재생기(oneShotAudio), 저장은 store가 한다.
// 음원은 정답 위치에서 둘로 나눠 쓴다: 앞부분은 정해진 시각에 틀고, 뒷부분(드럼 한 방과 후렴)은 허용 범위 안의 타격을 받은 순간 바로 튼다.
// 그래서 타격 판정과 뒷부분 재생은 화면 갱신을 기다리지 않고 타격을 받은 자리에서 한다.
import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import { TimingCalDialog } from '@/components/calibration/TimingCalDialog';
import { useTimingCalGate } from '@/components/calibration/useTimingCalGate';
import { useShell } from '@/components/shell/nav/useShell';
import { ONE_SHOT_AUDIO_BASE } from '@/config/miniOneShot';
import { isFootHit, isSensorSource } from '@/domain/events';
import { metronome } from '@/engine/Metronome';
import { MiniIntro } from '@/features/mini/components/MiniIntro';
import { MiniResultHero } from '@/features/mini/components/MiniResultHero';
import { miniGameInfo } from '@/features/mini/domain/miniCatalog';
import { OneShotArt } from '@/features/mini/components/oneshot/OneShotArt';
import { OneShotResult } from '@/features/mini/components/oneshot/OneShotResult';
import { OneShotSongPick } from '@/features/mini/components/oneshot/OneShotSongPick';
import { OneShotStage } from '@/features/mini/components/oneshot/OneShotStage';
import { hitTime } from '@/features/mini/domain/hitTime';
import { isNewBest, recordKey } from '@/features/mini/domain/miniRecord';
import {
  BACKING_LEAD_MS,
  LATE_LIMIT_MS,
  ONE_SHOT_CLOSING_MS,
  SHOT_TOLERANCE_MS,
  formatSigned,
  judgeShot,
  recordText,
  shotCaption,
  shotOffsetMs,
  shotScore,
  shotTitle,
  sideWord,
  whenLabel,
  type ClipState,
  type ShotOutcome,
  type ShotStep,
} from '@/features/mini/domain/oneShotRound';
import { ONE_SHOT_SONGS, clipMatches, songById, songUrl } from '@/features/mini/domain/oneShotSongs';
import { oneShotAudio } from '@/features/mini/oneShotAudio';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import { readOneShotSong, writeOneShotSong } from '@/features/mini/store/oneShotSongPref';
import { useMiniFlow } from '@/features/mini/useMiniFlow';
import { unlockAudio } from '@/runtime/audioUnlock';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import './mini.css';

const GAME_NAME = '정적 뒤 한 방';

/** 받아 둔 음원. `key`가 지금 고른 곡(과 다시 시도 횟수)과 같을 때만 쓴다 */
interface Clip {
  key: string;
  state: Exclude<ClipState, 'loading'>;
  buffer: AudioBuffer | null;
}

/** 그 판의 세 시각(`performance.now()` 축): 노래 시작 · 정적 시작 · 정답 */
interface ShotTimes {
  headAt: number;
  restAt: number;
  answerAt: number;
}

/** 시작을 막는 사유와 딸린 버튼. 준비됐으면 사유가 없다 */
function blockedBy(state: ClipState, onRetry: () => void): { text?: string; action?: { label: string; onClick: () => void } | null } {
  if (state === 'ready') return {};
  if (state === 'loading') return { text: '음원을 불러오는 중이에요.', action: null };
  if (state === 'mismatch') return { text: '준비한 음원이 이 게임에 맞지 않아요. 음원 파일을 확인해 주세요.', action: null };
  return { text: '음원을 불러오지 못했어요.', action: { label: '다시 시도', onClick: onRetry } };
}

export function OneShotGamePage() {
  useShell({ title: '미니게임' });
  const flow = useMiniFlow({ closingMs: ONE_SHOT_CLOSING_MS });
  const { phase, startedAt, finish, quit } = flow;
  // 곡은 안내에서만 바꾼다. 마지막에 고른 곡을 브라우저에 기억한다
  const [songId, setSongId] = useState(readOneShotSong);
  const song = songById(songId);
  const bestRecord = useMiniRecords((s) => s.best('oneshot', songId));
  const records = useMiniRecords((s) => s.records);
  const stickConnected = useLive((s) => s.connected[0] || s.connected[1]);
  const sensorKind = useSettings((s) => s.sensorKind);
  const timingCal = useSettings((s) => s.timingCal);
  const sensor = isSensorSource(sensorKind === 'none' ? 'keyboard' : sensorKind);
  // 센서 입력인데 박자 맞추기를 한 번도 권하지 않았으면 [시작하기]에서 먼저 권한다(리듬 게임의 첫 연주 전 권유와 같은 조건). 막지는 않는다
  const { gate: timingGate, dialog: timingDialog } = useTimingCalGate({ isSensor: () => sensor });
  // 안내의 [박자 맞추기]로 여는 대화상자
  const [calOpen, setCalOpen] = useState(false);

  // 음원: 안내 단계에서 미리 받아 풀어 둔다. 준비될 때까지 [시작하기]를 끈다
  const url = ONE_SHOT_AUDIO_BASE === null ? null : songUrl(ONE_SHOT_AUDIO_BASE, song);
  const [retry, setRetry] = useState(0);
  const clipKey = `${url ?? ''}#${retry}`;
  const [clip, setClip] = useState<Clip | null>(null);
  const clipState: ClipState = url === null ? 'failed' : clip !== null && clip.key === clipKey ? clip.state : 'loading';
  const buffer = clipState === 'ready' && clip !== null ? clip.buffer : null;

  // 그 판의 진행
  const [step, setStep] = useState<ShotStep>('backing');
  // 반주 판의 「지금 위치」 선: 노래가 시작되기까지 남은 시간과 정적에 닿기까지의 길이
  const [sweep, setSweep] = useState<{ delayMs: number; durationMs: number } | null>(null);
  const [outcome, setOutcome] = useState<ShotOutcome | null>(null);
  // 판정이 난 때(곡별 기록의 「방금」·「오늘」을 가리는 기준)
  const [judgedAt, setJudgedAt] = useState<Date | null>(null);
  // 판을 끝까지 못 한 까닭. 안내에 한 줄로 알린다
  const [notice, setNotice] = useState<'audio' | 'interrupted' | null>(null);
  // 이 판을 시작할 때의 최고 기록(같은 곡). 「새 최고 기록」은 이 값과 견준다
  const [previous, setPrevious] = useState<number | null>(null);
  // [그만하기]나 시작 실패로 안내에 돌아왔으면 [시작하기]에 포커스를 준다
  const [returned, setReturned] = useState(false);
  // 타격은 화면 갱신을 기다리지 않고 받은 자리에서 판정한다. 그때 읽을 값이라 상태가 아니라 ref에 둔다
  const timesRef = useRef<ShotTimes | null>(null);
  const judgedRef = useRef(false);

  // 다른 탭에서 바뀐 기록도 열 때 한 번 다시 읽는다
  useEffect(() => {
    useMiniRecords.getState().reload();
  }, []);

  // 정적 동안 박을 세어 주는 것이 있으면 안 된다(D13): 열릴 때 전역 메트로놈이 울리고 있으면 멈춘다
  useEffect(() => {
    const met = useLive.getState().metronome;
    if (met.playing && !met.locked) metronome.stop();
  }, []);

  // 이 화면에서는 친 드럼이 울린다(자유 연습과 같은 공용 경로). 성공하면 내 타격음과 원곡의 드럼이 같이 울린다
  useEffect(() => {
    setSoundOnHit(true);
    return () => setSoundOnHit(false);
  }, []);

  // 화면을 벗어나면 울리던 음원을 멈춘다
  useEffect(() => () => oneShotAudio.stop(), []);

  // 키보드 드럼은 치는 단계에서만 켠다. 안내·마무리·결과에서는 꺼져 있어 Space·Enter로 버튼을 누를 수 있다
  useKeyboardDrum(phase === 'countdown' || phase === 'playing');

  // 음원 받기. 곡을 바꾸거나 [다시 시도]를 누르면 다시 받는다. 화면을 벗어나면 받던 것을 그만둔다
  useEffect(() => {
    if (url === null) return;
    const ac = new AbortController();
    oneShotAudio.loadClip(url, ac.signal).then(
      (loaded) => {
        if (ac.signal.aborted) return;
        // 다르게 자른 파일이면 정답 위치가 어긋난다. 틀린 판정을 내는 대신 시작을 막는다(D21)
        setClip({ key: clipKey, state: clipMatches(song, loaded.duration * 1000) ? 'ready' : 'mismatch', buffer: loaded });
      },
      () => {
        if (ac.signal.aborted) return;
        setClip({ key: clipKey, state: 'failed', buffer: null });
      },
    );
    return () => ac.abort();
  }, [url, clipKey, song]);

  // 한 판: 앞부분을 예약하고, 정적·시간 초과 타이머를 걸고, 처음 받은 타격 하나로 판정한다
  useEffect(() => {
    if (phase !== 'playing' || startedAt === null || buffer === null) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const judge = (result: ShotOutcome) => {
      if (judgedRef.current) return;
      judgedRef.current = true;
      setJudgedAt(new Date());
      setOutcome(result);
      setStep('done');
    };
    /** 그 판을 버리고 안내로 돌아가 까닭을 알린다 */
    const abort = (reason: 'audio' | 'interrupted') => {
      if (judgedRef.current) return;
      judgedRef.current = true;
      oneShotAudio.stop();
      setNotice(reason);
      setReturned(true);
      quit();
    };

    // 예약은 다음 차례에 한다(효과 본문에서 상태를 바로 바꾸지 않는다)
    timers.push(
      setTimeout(() => {
        const when = oneShotAudio.playHead(buffer, audioEngine.perfToContextTime(startedAt + BACKING_LEAD_MS), song.answerMs);
        if (when === null) {
          // 오디오가 꺼져 있어 예약하지 못했다
          abort('audio');
          return;
        }
        // 재생기가 돌려준 실제 시작 시각으로 정적 시작과 정답 시각을 구해 화면 시계 값으로 바꿔 둔다
        const headAt = audioEngine.contextToPerfTime(when);
        const times: ShotTimes = { headAt, restAt: headAt + song.restStartMs, answerAt: headAt + song.answerMs };
        timesRef.current = times;
        const now = performance.now();
        setSweep({ delayMs: headAt - now, durationMs: song.restStartMs });
        // 정적이 시작되면 선이 사라지고 큰 문구가 바뀐다. 그 뒤로 화면은 움직이지 않는다
        timers.push(setTimeout(() => setStep((current) => (current === 'backing' ? 'rest' : current)), times.restAt - now));
        timers.push(setTimeout(() => judge({ kind: 'none' }), times.answerAt + LATE_LIMIT_MS - now));
      }, 0),
    );

    const unsubscribe = useLive.subscribe((s, prev) => {
      const hit = s.lastHit;
      // 패드를 판정하지 못한 타격과 판정 뒤의 타격은 받지 않는다
      if (s.hitSeq === prev.hitSeq || !hit || hit.pad === null || judgedRef.current) return;
      const times = timesRef.current;
      const settings = useSettings.getState();
      const at = hitTime(hit) - shotOffsetMs(isFootHit(hit), settings.audioOffsetMs, settings.kickOffsetMs);
      // 노래가 시작되기 전의 타격은 받지 않는다(소리만 난다)
      if (times === null || at < times.headAt) return;
      const result = judgeShot(at, times.restAt, times.answerAt);
      // 성공이면 뒷부분(드럼 한 방과 후렴)을 지금 바로 튼다. 그 밖에는 울리던 앞부분을 멈춘다
      if (result.kind === 'success') oneShotAudio.playTail(buffer, song.answerMs, song.tailMs);
      else oneShotAudio.stop();
      judge(result);
    });

    // 탭이 가려지거나 오디오가 멈추면 소리 시계와 화면 시계가 어긋난다. 그 판을 버린다(D15)
    const onVisibility = () => {
      if (document.hidden) abort('interrupted');
    };
    document.addEventListener('visibilitychange', onVisibility);
    const offState = audioEngine.onStateChange((state) => {
      if (state !== 'running') abort('interrupted');
    });

    return () => {
      timers.forEach(clearTimeout);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      offState();
    };
  }, [phase, startedAt, buffer, song, quit]);

  // 판정이 나면 끝을 알린다. 마무리 동안 플레이 화면에 오차를 보인다
  useEffect(() => {
    if (phase === 'playing' && outcome !== null) finish();
  }, [phase, outcome, finish]);

  // 결과가 확정될 때만 기록을 쓴다. 성공한 판만 남긴다(D10).
  // 같은 점수로 다시 불려도 동점은 갱신이 아니라서 저장 값이 바뀌지 않는다
  useEffect(() => {
    if (phase !== 'result' || outcome === null || outcome.kind !== 'success') return;
    useMiniRecords.getState().submit({
      gameId: 'oneshot',
      variant: song.id,
      score: Math.abs(outcome.errorMs),
      at: (judgedAt ?? new Date()).toISOString(),
      detail: { errorMs: outcome.errorMs },
    });
  }, [phase, outcome, song, judgedAt]);

  /** 그 판의 진행 값을 비운다 */
  const clearRound = () => {
    timesRef.current = null;
    setStep('backing');
    setSweep(null);
    setOutcome(null);
    setJudgedAt(null);
  };
  /** 새 판 준비: 진행 값을 비우고, 지금의 최고 기록(같은 곡)을 견줄 값으로 잡는다 */
  const begin = () => {
    judgedRef.current = false;
    clearRound();
    setNotice(null);
    setPrevious(useMiniRecords.getState().best('oneshot', song.id)?.score ?? null);
  };
  const onStart = () => {
    // 권유 대화상자를 띄웠으면 시작하지 않는다. 닫은 뒤 다시 누르면 넘어간다
    if (timingGate()) return;
    // 잠금을 풀지 못하면 앞부분을 예약할 때 드러난다(그때 안내로 돌아가 알린다)
    void unlockAudio().catch(() => undefined);
    begin();
    flow.start();
  };
  const onRetry = () => {
    oneShotAudio.stop();
    begin();
    flow.retry();
  };
  /** 소리와 판을 멈추고 안내로 돌아간다([그만하기]·[다른 곡]) */
  const toIntro = () => {
    judgedRef.current = true;
    oneShotAudio.stop();
    clearRound();
    setReturned(true);
    quit();
  };
  const onSong = (id: string) => {
    setSongId(id);
    writeOneShotSong(id);
  };

  if (phase === 'intro') {
    const best = bestRecord !== null && bestRecord.gameId === 'oneshot' ? bestRecord : null;
    const blocked = blockedBy(clipState, () => setRetry((n) => n + 1));
    const note =
      notice === 'audio'
        ? '소리를 켜지 못해 시작하지 못했어요. 브라우저의 소리 설정을 확인해 주세요.'
        : notice === 'interrupted'
          ? '소리가 끊겨서 판을 끝냈어요. 다시 시작해 주세요.'
          : sensor && timingCal === null
            ? {
                text: '박자 맞추기를 아직 안 했어요. 오차가 실제와 다르게 나올 수 있어요.',
                action: { label: '박자 맞추기', onClick: () => setCalOpen(true) },
              }
            : undefined;
    return (
      <main className="main">
        <MiniIntro
          overline={GAME_NAME}
          title={['노래가 멈춘 뒤', '돌아올 박에 한 방.']}
          description={miniGameInfo('oneshot').description}
          art={<OneShotArt size="hero" />}
          cells={[
            { label: '한 판', value: '1', unit: '타', note: '어느 패드를 쳐도 돼요' },
            { label: '성공', value: `±${SHOT_TOLERANCE_MS}`, unit: 'ms', note: '안에 치면 노래가 이어져요' },
            best === null
              ? { label: '내 최고 기록', value: '—', note: '이 브라우저에 저장돼요' }
              : { label: '내 최고 기록', value: String(best.score), unit: 'ms', note: sideWord(best.detail.errorMs) },
          ]}
          stickConnected={stickConnected}
          blocked={blocked.text}
          blockedAction={blocked.action}
          controls={<OneShotSongPick songs={ONE_SHOT_SONGS} value={song.id} onChange={onSong} />}
          note={note}
          focusStart={returned}
          onStart={onStart}
        />
        {timingDialog}
        {calOpen ? <TimingCalDialog onClose={() => setCalOpen(false)} /> : null}
      </main>
    );
  }

  if (phase === 'result' && outcome !== null) {
    const score = shotScore(outcome);
    const newBest = score !== null && isNewBest(previous === null ? null : { score: previous }, score, 'lower');
    const rows = ONE_SHOT_SONGS.map((item) => {
      const record = records[recordKey('oneshot', item.id)];
      if (!record || record.gameId !== 'oneshot') return { id: item.id, name: item.name, when: '', text: null };
      return {
        id: item.id,
        name: item.name,
        // 판정이 난 때를 기준으로 「방금」·「오늘」·「어제」를 가린다
        when: judgedAt === null ? '' : whenLabel(record.at, judgedAt, newBest && item.id === song.id),
        text: recordText(record.detail.errorMs),
      };
    });
    return (
      <main className="main">
        <div className="mini-page">
          <MiniResultHero
            overline={`${GAME_NAME} · ${song.name}`}
            tag={outcome.kind === 'success' ? { text: '성공', tone: 'good' } : { text: '실패', tone: 'bad' }}
            newBest={newBest}
            title={shotTitle(outcome)}
            score={
              'errorMs' in outcome
                ? { label: '오차', value: formatSigned(outcome.errorMs), unit: 'ms', note: shotCaption(outcome) }
                : { label: '오차', value: '–', note: shotCaption(outcome) }
            }
            onRetry={onRetry}
            extraAction={ONE_SHOT_SONGS.length > 1 ? { label: '다른 곡', onClick: toIntro } : undefined}
          />
          <OneShotResult outcome={outcome} rows={rows} />
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <OneShotStage
        phase={phase}
        countdown={flow.countdown}
        songs={ONE_SHOT_SONGS}
        songId={song.id}
        step={step}
        sweep={sweep}
        outcome={outcome}
        onQuit={toIntro}
      />
    </main>
  );
}
