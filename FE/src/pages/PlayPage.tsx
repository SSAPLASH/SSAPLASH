// 리듬 게임 (MODE-01, 설계 4-2). 곡 선택 → 준비 → 카운트인 → 플레이 → (일시정지) → 종료 → 결과.
// 엔진(RhythmSession)·레인(NoteHighway)·채보는 기존 코드. 이 페이지는 단계 전환, 입력 연결, HUD 값, 로그 저장을 맡는다.
// 화면은 Figma 연주 흐름을 조립한다: 곡 선택 SongPicker · 준비 ReadyPanel · 연주 PlayStage(HUD·하이웨이·킷). 연주 중은 셸을 숨긴 전체 화면이다(D2).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/keyTarget';
import { SongPicker } from '@/components/SongPicker';
import { useChartParam } from '@/components/useChartParam';
import { NoteHighway, type Popup } from '@/components/NoteHighway';
import { PauseOverlay, type PauseReason } from '@/components/PauseOverlay';
import { usePauseTriggers } from '@/components/usePauseTriggers';
import { useReadiness } from '@/components/useReadiness';
import { PlayStage } from '@/components/play/PlayStage';
import { PlayHud } from '@/components/play/PlayHud';
import { Countdown } from '@/components/play/Countdown';
import { GuideSlot } from '@/components/play/GuideSlot';
import { useCoachLine } from '@/components/play/useCoachLine';
import { HitReadout } from '@/components/play/HitReadout';
import { ReadyPanel } from '@/components/play/ReadyPanel';
import { DrumKit } from '@/components/drum/DrumKit';
import { usePadStates } from '@/components/drum/usePadStates';
import { useShell } from '@/components/shell/useShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Chart } from '@/domain/chart';
import { sortCharts, type SongDetail } from '@/domain/songCatalog';
import { bestAccuracyByChart } from '@/domain/bestRecord';
import type { PadId } from '@/domain/pads';
import type { InputSourceKind } from '@/domain/events';
import { KEY_MAP } from '@/domain/keyMap';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import { buildPlayLog, loadPlayLogs, savePlayLog } from '@/engine/playLog';
import { PlayRecorder } from '@/engine/playRecorder';
import { readCurrentConsent } from '@/app/dataConsent';
import { coachCopy, LiveCoach, type CoachCopy } from '@/coach/live';
import { startPlaySync } from '@/app/playSync';
import { diagSessionEnd, diagSessionPhase, diagSessionStart, reportHit } from '@/engine/diagReport';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/app/sources';
import { setSoundOnHit, unlockAudio } from '@/app/bootstrap';
import { audioEngine } from '@/audio/AudioEngine';
import { Accompaniment } from '@/audio/Accompaniment';
import { PlayClock } from '@/engine/sessionClock';
import { metronome } from '@/engine/Metronome';
import { useSettings } from '@/store/settingsStore';
import { usePresets } from '@/store/presetStore';
import { useLive } from '@/store/liveStore';
import { useReconnect } from '@/store/reconnectStore';
import { useSongs } from '@/store/songStore';

// loading: URL의 곡·채보를 불러오는 중(실패하면 같은 단계에서 오류 문구)
type Stage = 'select' | 'loading' | 'ready' | 'play';

/** 개발용: 설정하면 모든 곡에 이 반주 URL을 쓴다(로컬 BE에 S3가 없을 때) */
const ACCOMPANIMENT_OVERRIDE: string | undefined = import.meta.env.VITE_ACCOMPANIMENT_OVERRIDE || undefined;

/** 카운트인이 끝난 직후 「시작!」을 보이는 시간 */
const GO_MS = 400;

function parseId(raw: string | null): number | null {
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function PlayPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const param = useChartParam();
  const [searchParams] = useSearchParams();
  const songIdParam = parseId(searchParams.get('song'));
  const chartIdParam = parseId(searchParams.get('chart'));
  const [stage, setStage] = useState<Stage>(param.status === 'none' ? 'select' : 'loading');
  const [chart, setChart] = useState<Chart | null>(null);
  const [session, setSession] = useState<RhythmSession | null>(null);
  const [hud, setHud] = useState<SessionSnapshot | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  // 카운트다운 표시값(남은 박 수 · 'go' · 없음)
  const [countValue, setCountValue] = useState<number | 'go' | null>(null);
  // 곡 상세(커버·가수·연습 단계 목록). 준비·연주 화면이 쓴다
  const [detail, setDetail] = useState<SongDetail | null>(null);
  // 반주 디코드 단계 표시·오류
  const [accStatus, setAccStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [accError, setAccError] = useState<string | null>(null);
  const [acc] = useState(() => new Accompaniment(audioEngine));
  const clockRef = useRef<PlayClock | null>(null);
  // 준비 조건 미충족이면 시작하지 못한다(키보드 전용은 면제). 키 핸들러·begin이 최신 값을 보도록 ref에도 둔다
  const { ready, missing } = useReadiness();
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // 연주 중(play)은 셸을 숨긴 전체 화면(D2). 곡 선택·준비는 TopBar 제목 "리듬 게임"
  useShell({ title: '리듬 게임', immersive: stage === 'play' });

  const connected = useLive((l) => l.connected);
  const reconnectAvailable = useReconnect((r) => r.available);
  const reconnect = useReconnect((r) => r.reconnect);
  const lastHit = useLive((l) => l.lastHit);
  const presets = usePresets((p) => p.items);
  const presetName = presets.find((p) => p.id === settings.activePresetId)?.name ?? null;
  const selectSong = useSongs((s) => s.selectSong);
  // 킷 미니 뷰: 타격(hit)·판정 색
  const padStates = usePadStates(session);

  // 그리기 루프·입력 리스너가 최신 상태를 보도록 ref에 복사 (렌더 중 ref 쓰기 회피)
  const stageRef = useRef<Stage>(stage);
  const sessionRef = useRef<RhythmSession | null>(null);
  const pauseRef = useRef<PauseReason | null>(null);
  useEffect(() => {
    stageRef.current = stage;
    sessionRef.current = session;
    pauseRef.current = pauseReason;
  }, [stage, session, pauseReason]);

  const flashes = useRef(new Map<PadId, number>());
  const popups = useRef<Popup[]>([]);
  const recorder = useRef(new PlayRecorder());
  // 실시간 코칭: 곡 선택 시점에 설정값을 고정해 만든다(설계 D7). 안내 칸에 띄울 문구는 훅이 displayMs 동안 들고 있는다
  const coachRef = useRef<LiveCoach | null>(null);
  const { line: coachLine, show: showCoachLine, clear: clearCoachLine } = useCoachLine<CoachCopy>();
  const startedAt = useRef<Date | null>(null);
  const consentAtStart = useRef(false);
  const lastHud = useRef(0);
  const finishing = useRef(false);
  // 카운트인이 진행 중이었는지(끝난 순간 「시작!」을 보이려고) · 「시작!」 숨김 타이머
  const wasCountin = useRef(false);
  const goTimer = useRef<number | null>(null);

  const returnTo = location.pathname + location.search;
  const clearParam = param.clear;

  const inputSource: InputSourceKind = settings.sensorKind === 'none' ? 'keyboard' : settings.sensorKind;

  const resetCountdown = useCallback(() => {
    wasCountin.current = false;
    if (goTimer.current !== null) {
      window.clearTimeout(goTimer.current);
      goTimer.current = null;
    }
    setCountValue(null);
  }, []);

  // 진입: 공용 발음을 끄고 이 페이지가 직접 소리·텔레메트리를 낸다. 떠날 때 되돌린다
  useEffect(() => {
    setSoundOnHit(false);
    return () => {
      diagSessionEnd('left');
      setSoundOnHit(true);
      inputManager.setCandidateProvider(null);
      clockRef.current?.stop();
      metronome.unlock();
      acc.unload();
      if (goTimer.current !== null) window.clearTimeout(goTimer.current);
    };
  }, [acc]);

  // 곡 상세: URL의 곡이 바뀌면 다시 읽는다(실패해도 연주는 채보 정보만으로 진행)
  useEffect(() => {
    if (songIdParam === null) return;
    let cancelled = false;
    selectSong(songIdParam).then(
      (d) => {
        if (!cancelled) setDetail(d);
      },
      () => {
        // 상세 없이도 준비·연주는 가능하다
      },
    );
    return () => {
      cancelled = true;
    };
  }, [songIdParam, selectSong]);

  // 타격: 즉시 발음(D6) → 햅틱 → 플래시 → 판정 → 로그·텔레메트리
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.pad) {
        const tAudio = audioEngine.trigger(hit.pad, hit.velocity);
        if (tAudio !== null) hit.tAudio = tAudio;
        inputManager.haptic(hit.stickId, hit.velocity * 2, 30);
        flashes.current.set(hit.pad, performance.now());
      }
      const ss = sessionRef.current;
      const active =
        ss &&
        stageRef.current === 'play' &&
        pauseRef.current === null &&
        (ss.currentStatus === 'playing' || ss.currentStatus === 'countin');
      const ev = active ? ss.handleHit(hit) : null;
      if (active) recorder.current.hit(hit, ev, ss);
      reportHit(hit, ev, active ? ss : null);
    });
  }, []);

  const choose = useCallback(
    (c: Chart) => {
      const ss = new RhythmSession(c, {
        windows: settings.timing,
        countInBars: settings.countInBars,
        audioOffsetMs: settings.audioOffsetMs,
      });
      const coach = new LiveCoach({ goodMs: settings.timing.goodMs, enabled: settings.liveCoach });
      coachRef.current = coach;
      clearCoachLine();
      ss.onJudgement((e) => {
        recorder.current.judgement(e);
        popups.current.push({ judgement: e.judgement, deltaMs: e.deltaMs, pad: e.pad, at: performance.now() });
        setHud(ss.snapshot());
        // 코칭은 기록·팝업·HUD 뒤에 한다. 변환·표시가 실패해도 플레이를 막지 않는다
        const message = coach.push({
          songTimeMs: ss.songTime(e.at),
          noteTimeMs: ss.notes[e.noteIndex].note.timeMs,
          judgement: e.judgement,
          deltaMs: e.deltaMs,
          pad: e.pad,
          stickId: e.stickId,
          velocity: e.velocity,
        });
        if (!message) return;
        try {
          const copy = coachCopy(message);
          if (copy) showCoachLine(copy, message.displayMs);
        } catch {
          // 코칭 오류는 무시한다
        }
      });
      flashes.current.clear();
      popups.current = [];
      recorder.current.reset();
      finishing.current = false;
      resetCountdown();
      setChart(c);
      setSession(ss);
      setHud(ss.snapshot());
      setPauseReason(null);
      setStage('ready');
    },
    [settings.timing, settings.countInBars, settings.audioOffsetMs, settings.liveCoach, resetCountdown, clearCoachLine, showCoachLine],
  );

  // URL의 곡·채보 → 로딩 → 준비 화면. 쿼리가 사라지면(뒤로 가기·곡 선택으로) 선택 단계로 돌아간다.
  // 연주 중에는 URL 변화를 따라가지 않는다
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  }, [choose]);
  const { status: paramStatus, loaded: paramLoaded } = param;
  useEffect(() => {
    if (stageRef.current === 'play') return;
    if (paramStatus === 'loading') {
      setStage('loading');
    } else if (paramStatus === 'ready' && paramLoaded) {
      const url = ACCOMPANIMENT_OVERRIDE ?? paramLoaded.assets?.accompanimentUrl ?? null;
      if (!url) {
        acc.unload();
        chooseRef.current(paramLoaded.chart);
        return;
      }
      // 반주는 준비 화면 전에 디코드해 둔다
      const ctrl = new AbortController();
      setAccStatus('loading');
      setAccError(null);
      setStage('loading');
      acc.load(url, ctrl.signal).then(
        () => {
          if (ctrl.signal.aborted) return;
          setAccStatus('idle');
          chooseRef.current(paramLoaded.chart);
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          setAccStatus('error');
          setAccError(e instanceof Error ? e.message : '반주를 불러오지 못했습니다.');
        },
      );
      return () => ctrl.abort();
    } else if (paramStatus === 'none') {
      inputManager.setCandidateProvider(null);
      setPauseReason(null);
      setSession(null);
      setChart(null);
      setHud(null);
      setStage('select');
    }
  }, [paramStatus, paramLoaded, acc]);

  const begin = useCallback(async () => {
    const ss = sessionRef.current;
    if (!ss || stageRef.current !== 'ready' || !readyRef.current) return;
    await unlockAudio();
    startedAt.current = new Date();
    consentAtStart.current = readCurrentConsent();
    metronome.lock({ bpm: ss.chart.bpm, beatsPerBar: ss.chart.beatsPerBar });
    clockRef.current?.stop();
    const clock = new PlayClock(ss, {
      click: (at, accent) => audioEngine.click(at, accent),
      accompaniment: acc.state === 'ready' ? acc : undefined,
      clickOn: () => useSettings.getState().metronome,
      onBeat: (beatInBar, atMs) => metronome.pulse(beatInBar, atMs),
    });
    clockRef.current = clock;
    clock.begin();
    inputManager.setCandidateProvider((t) => ss.candidates(t));
    diagSessionStart(ss, 'RHYTHM', { windows: useSettings.getState().timing, audioOffsetMs: useSettings.getState().audioOffsetMs });
    setStage('play');
  }, [acc]);

  const toSelect = useCallback(() => {
    diagSessionEnd('left');
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    resetCountdown();
    setPauseReason(null);
    setSession(null);
    setChart(null);
    setHud(null);
    setStage('select');
    clearParam();
  }, [clearParam, resetCountdown]);

  const pauseTo = useCallback((reason: PauseReason) => {
    const clock = clockRef.current;
    if (stageRef.current !== 'play' || !clock || pauseRef.current !== null) return;
    clock.pause(reason);
    diagSessionPhase('pause');
    // 같은 틱의 중복 트리거(끊김 + 메뉴)를 막기 위해 ref도 바로 갱신한다
    pauseRef.current = reason;
    setPauseReason(reason);
  }, []);

  // 연결 끊김·메뉴 요청 → 자동 일시정지 (설계 4-3, 8절)
  usePauseTriggers(pauseTo);

  const resume = useCallback(() => {
    const clock = clockRef.current;
    if (!clock || pauseRef.current === null || !readyRef.current) return;
    clock.resume();
    diagSessionPhase('resume');
    setPauseReason(null);
  }, []);

  // 처음부터: 카운트인부터 다시. 메트로놈 잠금은 유지한다
  const restart = useCallback(() => {
    const clock = clockRef.current;
    const ss = sessionRef.current;
    if (!clock || !ss) return;
    clock.restart();
    diagSessionStart(ss, 'RHYTHM', { windows: useSettings.getState().timing, audioOffsetMs: useSettings.getState().audioOffsetMs });
    flashes.current.clear();
    popups.current = [];
    recorder.current.reset();
    coachRef.current?.reset();
    clearCoachLine();
    finishing.current = false;
    startedAt.current = new Date();
    consentAtStart.current = readCurrentConsent();
    resetCountdown();
    setHud(ss.snapshot());
    setPauseReason(null);
  }, [resetCountdown, clearCoachLine]);

  // 나가기: 기록 없이 준비 화면으로(곡 선택·URL 유지). 세션을 새로 만든다
  const leave = useCallback(() => {
    const c = sessionRef.current?.chart;
    diagSessionEnd('left');
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    setPauseReason(null);
    if (c) choose(c);
  }, [choose]);

  const finish = useCallback(
    (ss: RhythmSession) => {
      if (finishing.current) return;
      finishing.current = true;
      diagSessionEnd('finished');
      clockRef.current?.stop();
      metronome.unlock();
      inputManager.setCandidateProvider(null);
      const log = buildPlayLog({
        snapshot: ss.snapshot(),
        notes: ss.notes,
        hits: recorder.current.hits,
        missSeqs: recorder.current.missSeqs,
        audioOffsetMs: ss.audioOffsetMs,
        countInMs: ss.countInMs,
        chart: ss.chart,
        inputSource,
        timing: settings.timing,
        startedAt: startedAt.current ?? new Date(),
        chartVersionId: ss.chart.chartVersionId ?? null,
        songNumericId: ss.chart.songNumericId ?? null,
        chartId: ss.chart.chartId ?? null,
        presetId: useSettings.getState().activePresetId,
        consent: consentAtStart.current,
        liveCoachEvents: coachRef.current ? [...coachRef.current.events()] : undefined,
      });
      savePlayLog(log);
      // 서버 업로드는 결과 화면을 막지 않는다(설계 COACH-002 D1)
      void startPlaySync(log.playId);
      navigate(`/result/${log.playId}`);
    },
    [navigate, inputSource, settings.timing],
  );

  // 매 프레임: 세션 시계(Miss 처리·종료 감지·박 클릭 예약)는 PlayClock, 여기서는 카운트다운 값과 HUD 4Hz 갱신
  const onFrame = useCallback(
    (now: number) => {
      const ss = sessionRef.current;
      if (!ss || stageRef.current !== 'play') return;
      const clock = clockRef.current;
      if (!clock) return;
      clock.onFrame(now);
      if (clock.state.phase === 'finished') {
        finish(ss);
        return;
      }
      // 카운트다운: 카운트인 동안 남은 박 수, 끝난 직후 잠깐 「시작!」(일시정지 중에는 값을 건드리지 않는다)
      const status = ss.currentStatus;
      if (status === 'countin') {
        wasCountin.current = true;
        setCountValue(Math.max(1, Math.ceil(-ss.songTime(now) / ss.beatMs)));
      } else if (status === 'playing' && wasCountin.current) {
        wasCountin.current = false;
        setCountValue('go');
        goTimer.current = window.setTimeout(() => {
          goTimer.current = null;
          setCountValue(null);
        }, GO_MS);
      }
      if (now - lastHud.current > 250) {
        lastHud.current = now;
        setHud(ss.snapshot(now));
      }
    },
    [finish],
  );

  // Enter / Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // D1: 처리하지 않는 경우·포커스 요소가 소유한 키는 가로채지 않는다
      if (e.isComposing || e.defaultPrevented) return;
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      if (isKeyOwnedByTarget(e.target as KeyTarget, e.code)) return;
      const st = stageRef.current;
      if (st === 'ready') {
        if (e.code === 'Enter') void begin();
        else toSelect();
      } else if (st === 'play') {
        // 일시정지 중에는 다이얼로그가 키를 소유한다(D6)
        if (pauseRef.current !== null || e.code !== 'Escape') return;
        pauseTo('user');
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [begin, toSelect, pauseTo]);

  // 준비 화면: 고른 연습 단계의 최고 정확도(이 기기의 플레이 로그, U18)
  const selectedChartId = chartIdParam ?? chart?.chartId ?? 0;
  const bestAccuracy = useMemo(
    () => (stage === 'ready' ? bestAccuracyByChart(loadPlayLogs(), 'RHYTHM').get(selectedChartId) : undefined),
    [stage, selectedChartId],
  );

  // 불러오는 중·오류. 연습 단계를 바꿔 다시 불러올 때도 이 카드로 돌아온다
  if (stage === 'loading') {
    return (
      <main className="main">
        <Card padding="md" style={{ maxWidth: 480 }}>
          <div className="col">
            {accStatus === 'error' ? (
              <>
                <div className="notice error" role="alert">
                  {accError ?? '반주를 불러오지 못했습니다.'}
                </div>
                <div className="row">
                  {param.loaded && (
                    <Button
                      onClick={() => {
                        acc.unload();
                        setAccStatus('idle');
                        if (param.loaded) choose(param.loaded.chart);
                      }}
                    >
                      반주 없이 계속
                    </Button>
                  )}
                  <Button variant="secondary" onClick={toSelect}>
                    곡 선택으로
                  </Button>
                </div>
              </>
            ) : param.status === 'error' ? (
              <>
                <div className="notice error" role="alert">
                  {param.error ?? '채보를 불러오지 못했습니다.'}
                </div>
                <Button variant="secondary" onClick={toSelect}>
                  곡 선택으로
                </Button>
              </>
            ) : (
              <div className="row">
                <span className="spinner" aria-label="불러오는 중" />
                <span className="dim">{accStatus === 'loading' ? '반주 불러오는 중' : '채보를 불러오는 중'}</span>
              </div>
            )}
          </div>
        </Card>
      </main>
    );
  }

  if (stage === 'select' || !chart || !session) {
    return (
      <main className="main">
        <SongPicker mode="play" onSelect={param.select} />
      </main>
    );
  }

  const sameSong = detail !== null && (songIdParam === null || detail.id === songIdParam);
  const song = {
    title: chart.title,
    artist: sameSong ? detail.artist : '',
    coverUrl: sameSong ? detail.coverUrl : null,
    bpm: chart.bpm,
    durationSec: chart.durationMs / 1000,
  };

  if (stage === 'ready') {
    const charts = sameSong
      ? sortCharts(detail.charts).map((c) => ({ id: c.id, difficulty: c.difficulty }))
      : [{ id: selectedChartId, difficulty: chart.difficulty }];
    return (
      <main className="main">
        <ReadyPanel
          song={song}
          modeLabel="리듬 게임"
          charts={charts}
          selectedChartId={selectedChartId}
          bestAccuracy={bestAccuracy}
          ready={ready}
          missing={missing}
          connected={connected}
          keyboardOnly={settings.sensorKind === 'none'}
          presetName={presetName}
          countInBars={settings.countInBars}
          onBack={toSelect}
          onSelectChart={(chartId) => {
            if (songIdParam !== null && chartId !== selectedChartId) param.select(songIdParam, chartId);
          }}
          onSetup={() => navigate('/setup', { state: { returnTo, returnLabel: `리듬 게임 · ${chart.title}` } })}
          onReconnect={reconnectAvailable ? () => void reconnect() : undefined}
          onStart={() => void begin()}
        />
      </main>
    );
  }

  // 연주 중. 정확도는 지금까지 판정한 노트 기준(곡 전체 기준 정확도는 결과 화면)
  const snap = hud ?? session.snapshot();
  const perfectScore = session.notes.length ? snap.maxScore / session.notes.length : 0;
  const accuracy =
    snap.judgedCount > 0 && perfectScore > 0 ? Math.min(100, (snap.score / (snap.judgedCount * perfectScore)) * 100) : null;

  let overlay = null;
  if (pauseReason !== null) {
    overlay = (
      <PauseOverlay
        reason={pauseReason}
        canResume={ready}
        onResume={resume}
        onRestart={restart}
        onLeave={leave}
        returnTo={returnTo}
      />
    );
  } else if (countValue !== null) {
    overlay = <Countdown value={countValue} />;
  }

  return (
    <main>
      <PlayStage
        variant="game"
        hud={
          <PlayHud
            variant="game"
            title={song.title}
            artist={song.artist || undefined}
            coverUrl={song.coverUrl}
            level={chart.difficulty}
            bpm={chart.bpm}
            elapsedMs={snap.songTimeMs}
            durationMs={chart.durationMs}
            score={snap.score}
            combo={snap.combo}
            accuracy={accuracy}
          />
        }
        area={
          <NoteHighway
            session={session}
            scrollMs={settings.scrollMs}
            flashes={flashes}
            popups={popups}
            keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
            onFrame={onFrame}
          />
        }
        // 코칭 모드는 라벨+제목 두 줄만 — 보조까지 세 줄이면 51px 칸을 넘친다(설계 U1 결정, 브라우저 확인 64px)
        guide={
          coachLine ? (
            <GuideSlot mode={coachLine.mode} title={coachLine.title} />
          ) : (
            <GuideSlot mode="guide" title="노트에 맞춰 연주" sub="판정선에 노트가 닿을 때 타격하세요." />
          )
        }
        kit={<DrumKit scale={0.7} states={padStates} labels={false} />}
        readout={
          <HitReadout
            variant="stack"
            pad={lastHit?.pad ?? undefined}
            hand={lastHit ? (lastHit.stickId === 0 ? 'L' : 'R') : undefined}
            velocity={lastHit?.velocity}
          />
        }
        overlay={overlay}
      />
    </main>
  );
}
