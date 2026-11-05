// 악보 연주 (MODE-003 설계 4-1~4-4). 곡 선택 → 불러오기(채보·반주) → 준비 → 카운트인 → 연주 → 결과 페이지.
// PlayPage와 같은 골격(PlayClock·반주·메트로놈 잠금)이다. 화면은 Figma 악보 연습 흐름을 조립한다:
// 곡 선택 SongPicker · 준비 ReadyPanel(+PlayOptions) · 연주 PlayStage(PlayHud sheet·SheetPager·DrumKit 다음 박 배지). 연주 중은 셸을 숨긴 전체 화면이다.
// 점수·콤보는 보이지 않고 노트 색과 판정 수만 보인다. 일시정지는 Esc·스틱 끊김·메뉴 요청 3종(PauseOverlay).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/keyTarget';
import { SongPicker } from '@/components/SongPicker';
import { useChartParam } from '@/components/useChartParam';
import { SheetPager } from '@/components/SheetPager';
import { usePauseTriggers } from '@/components/usePauseTriggers';
import { useReconnectResume } from '@/components/useReconnectResume';
import { PauseOverlay, type PauseReason } from '@/components/PauseOverlay';
import { PlayStage } from '@/components/play/PlayStage';
import { PlayHud } from '@/components/play/PlayHud';
import { Countdown } from '@/components/play/Countdown';
import { ScreenGate } from '@/components/ScreenGate';
import { useScreenFits } from '@/components/screenFit';
import { GuideSlot } from '@/components/play/GuideSlot';
import { useCoachLine } from '@/components/play/useCoachLine';
import { HitReadout } from '@/components/play/HitReadout';
import { ReadyPanel } from '@/components/play/ReadyPanel';
import { pedalConnected, pedalRequired } from '@/domain/pedalStatus';
import { PlayOptions } from '@/components/play/PlayOptions';
import { useNextBeatLabels } from '@/components/play/useNextBeatLabels';
import { DrumKit } from '@/components/drum/DrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { usePlayRunning, useShell } from '@/components/shell/useShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useReadiness } from '@/components/useReadiness';
import type { Chart } from '@/domain/chart';
import { sortCharts, type SongDetail } from '@/domain/songCatalog';
import { bestAccuracyByChart } from '@/domain/bestRecord';
import type { Judgement } from '@/domain/judgement';
import type { InputSourceKind } from '@/domain/events';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import { buildPlayLog, loadPlayLogs, savePlayLog } from '@/engine/playLog';
import { PlayRecorder } from '@/engine/playRecorder';
import { readCurrentConsent } from '@/app/dataConsent';
import { startPlaySync } from '@/app/playSync';
import { disarm, finishSong, setLocked } from '@/app/recordingStore';
import { diagSessionEnd, diagSessionPhase, diagSessionStart, reportHit } from '@/engine/diagReport';
import { PlayClock } from '@/engine/sessionClock';
import { metronome } from '@/engine/Metronome';
import { inputManager } from '@/app/sources';
import { setSoundOnHit, unlockAudio } from '@/app/bootstrap';
import { audioEngine } from '@/audio/AudioEngine';
import { Accompaniment } from '@/audio/Accompaniment';
import { useSongs, type LoadedChart } from '@/store/songStore';
import { useLive } from '@/store/liveStore';
import { useReconnect } from '@/store/reconnectStore';
import { usePresets } from '@/store/presetStore';
import { useSettings } from '@/store/settingsStore';
import { coachCopy, LiveCoach, type CoachCopy } from '@/coach/live';

// 단계는 URL 파라미터 상태·세션에서 렌더 중 파생한다. paused는 pauseReason으로 표시
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

/** HUD 갱신 간격(ms) */
const HUD_INTERVAL_MS = 250;

/** 반주 디코드 결과. loaded가 현재 URL 파라미터의 결과와 같을 때만 유효하다 */
interface AccResult {
  loaded: LoadedChart;
  ok: boolean;
  error?: string;
}

function SheetPageBody() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const presetItems = usePresets((p) => p.items);
  const param = useChartParam();
  const { status: paramStatus, loaded: paramLoaded } = param;
  const [searchParams] = useSearchParams();
  const songIdParam = parseId(searchParams.get('song'));
  const chartIdParam = parseId(searchParams.get('chart'));
  const [acc] = useState(() => new Accompaniment(audioEngine));
  const [accResult, setAccResult] = useState<AccResult | null>(null);
  // 연주 중인 세션. 연주 중 설정이 바뀌어도 세션을 새로 만들지 않도록 begin 때 고정한다
  const [playSession, setPlaySession] = useState<RhythmSession | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const [hud, setHud] = useState<SessionSnapshot | null>(null);
  // HUD 표시용 곡 시각(ms)
  const [songMs, setSongMs] = useState(0);
  // 카운트다운 표시값(남은 박 수 · 'go' · 없음)
  const [countValue, setCountValue] = useState<number | 'go' | null>(null);
  // 곡 상세(커버·가수·연습 단계 목록). 준비·연주 화면이 쓴다
  const [detail, setDetail] = useState<SongDetail | null>(null);
  const [noteStates, setNoteStates] = useState<(Judgement | null)[]>([]);
  const [strays, setStrays] = useState<{ timeMs: number }[]>([]);
  const clockRef = useRef<PlayClock | null>(null);
  // 실시간 코칭(COACH-001). 연주 시작 시점 설정값으로 고정하고 문구는 안내 칸에 3초 띄운다 — 리듬 게임과 같은 연결
  const coachRef = useRef<LiveCoach | null>(null);
  const { line: coachLine, show: showCoachLine, clear: clearCoachLine } = useCoachLine<CoachCopy>();

  // 준비 조건 미충족이면 시작·재개하지 못한다(키보드 전용은 면제)
  const { ready, missing } = useReadiness();
  const connected = useLive((l) => l.connected);
  const pedalPair = useLive((l) => l.pedal.connected);
  const lastHit = useLive((l) => l.lastHit);
  const reconnectAvailable = useReconnect((r) => r.available);
  const reconnect = useReconnect((r) => r.reconnect);
  const selectSong = useSongs((s) => s.selectSong);
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // 반주 URL: 개발 override > 자산. 없으면 반주 없이 클릭만
  const accUrl = paramLoaded ? (ACCOMPANIMENT_OVERRIDE ?? paramLoaded.assets?.accompanimentUrl ?? null) : null;
  const accCurrent = accResult && accResult.loaded === paramLoaded ? accResult : null;
  const accLoading = accUrl !== null && accCurrent === null;
  const accError = accCurrent && !accCurrent.ok ? (accCurrent.error ?? '반주를 불러오지 못했습니다.') : null;
  const readyChart: Chart | null = paramLoaded && (accUrl === null || accCurrent?.ok) ? paramLoaded.chart : null;

  // 준비 단계 세션. 설정이 바뀌면 준비 화면에서만 새로 만든다
  const session = useMemo(
    () =>
      readyChart
        ? new RhythmSession(readyChart, {
            windows: settings.timing,
            countInBars: settings.countInBars,
            audioOffsetMs: settings.audioOffsetMs,
          })
        : null,
    [readyChart, settings.timing, settings.countInBars, settings.audioOffsetMs],
  );
  const activeSession = playSession ?? session;
  const chart = activeSession?.chart ?? null;
  const stage: Stage = playSession
    ? 'play'
    : session
      ? 'ready'
      : paramStatus === 'none' && !paramLoaded
        ? 'select'
        : 'loading';

  // 그리기 루프·입력 리스너가 최신 상태를 보도록 ref에 복사 (렌더 중 ref 쓰기 회피)
  const stageRef = useRef<Stage>(stage);
  const sessionRef = useRef<RhythmSession | null>(null);
  const pauseRef = useRef<PauseReason | null>(null);
  // 세로·좁은 화면 안내(ScreenGate)가 열려 있는지. 키 핸들러가 최신 값을 본다
  const screenOk = useScreenFits();
  const gateOpenRef = useRef(!screenOk);
  useEffect(() => {
    stageRef.current = stage;
    sessionRef.current = activeSession;
    pauseRef.current = pauseReason;
    gateOpenRef.current = !screenOk;
  }, [stage, activeSession, pauseReason, screenOk]);

  const recorder = useRef(new PlayRecorder());
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
      // 녹음 스위치 해제(armed였으면 idle로, 잠금도 푼다)
      disarm();
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

  // 반주는 준비 화면 전에 디코드해 둔다. URL이 바뀌면(다른 곡) 이전 로드는 취소한다
  useEffect(() => {
    if (!paramLoaded) return;
    if (!accUrl) {
      acc.unload();
      return;
    }
    const ctrl = new AbortController();
    acc.load(accUrl, ctrl.signal).then(
      () => {
        if (!ctrl.signal.aborted) setAccResult({ loaded: paramLoaded, ok: true });
      },
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        setAccResult({
          loaded: paramLoaded,
          ok: false,
          error: e instanceof Error ? e.message : '반주를 불러오지 못했습니다.',
        });
      },
    );
    return () => ctrl.abort();
  }, [paramLoaded, accUrl, acc]);

  // 판정 → 노트 색(새 배열로 갱신: SheetPager가 렌더 후 ref에 복사한다) · HUD
  useEffect(() => {
    if (!activeSession) return;
    return activeSession.onJudgement((e) => {
      recorder.current.judgement(e);
      setNoteStates((prev) => {
        const next = prev.slice();
        next[e.noteIndex] = e.judgement;
        return next;
      });
      setHud(activeSession.snapshot());
      // 코칭은 기록·노트 색·HUD 뒤에 한다. 변환·표시가 실패해도 연주를 막지 않는다
      const coach = coachRef.current;
      if (!coach) return;
      const message = coach.push({
        songTimeMs: activeSession.songTime(e.at),
        noteTimeMs: activeSession.notes[e.noteIndex].note.timeMs,
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
  }, [activeSession, showCoachLine]);

  // 타격: 즉시 발음 → 햅틱 → 판정 → 로그·텔레메트리. 일시정지 중에는 세션에 넣지 않는다
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.pad) {
        const tAudio = audioEngine.trigger(hit.pad, hit.velocity);
        if (tAudio !== null) hit.tAudio = tAudio;
        // 페달 타격(stickId null)에는 모터가 없어 보내지 않는다
        if (hit.stickId !== null) inputManager.haptic(hit.stickId, hit.velocity * 2, 30);
      }
      const ss = sessionRef.current;
      const active =
        ss &&
        stageRef.current === 'play' &&
        pauseRef.current === null &&
        // 복귀 카운트다운 중에는 pauseReason이 null이지만 시계는 멈춰 있다 — 그 사이 타격을 판정하지 않는다
        clockRef.current?.state.phase === 'running' &&
        (ss.currentStatus === 'playing' || ss.currentStatus === 'countin');
      const ev = active ? ss.handleHit(hit) : null;
      if (active) {
        const lh = recorder.current.hit(hit, ev, ss);
        // 채보 밖 타격: 악보에 작은 점으로 남긴다. 판정과 같은 곡 시각(오디오 오프셋 반영)
        if (!ev && hit.pad && lh.tSongMs !== undefined) {
          const timeMs = lh.tSongMs;
          setStrays((prev) => [...prev, { timeMs }]);
        }
      }
      reportHit(hit, ev, active ? ss : null);
    });
  }, []);

  const pauseTo = useCallback((reason: PauseReason) => {
    const clock = clockRef.current;
    if (stageRef.current !== 'play' || !clock || pauseRef.current !== null) return;
    // 복귀 카운트다운 중(clock은 이미 정지)에 다시 끊겨도 pause 진단 기록이 두 번 남지 않게 한다
    const wasRunning = clock.state.phase === 'running';
    clock.pause(reason);
    if (wasRunning) diagSessionPhase('pause');
    // 같은 틱의 중복 트리거(끊김 + 메뉴)를 막기 위해 ref도 바로 갱신한다
    pauseRef.current = reason;
    setPauseReason(reason);
  }, []);

  // 연결 끊김·메뉴 요청 → 자동 일시정지 (공용 훅)
  usePauseTriggers(pauseTo);

  // 연주 중(카운트다운 포함) 화면 조건이 깨지면 먼저 일시정지한다. 다시 맞아도 자동 재개하지 않는다.
  // pauseTo가 이미 멈춘 상태(pauseRef 있음)는 무시하므로 중복 호출에 안전하다
  useEffect(() => {
    if (!screenOk && stage === 'play' && pauseReason === null) pauseTo('user');
  }, [screenOk, stage, pauseReason, pauseTo]);

  const finish = useCallback(
    (ss: RhythmSession) => {
      if (finishing.current) return;
      finishing.current = true;
      diagSessionEnd('finished');
      clockRef.current?.stop();
      metronome.unlock();
      inputManager.setCandidateProvider(null);
      // 곡 시작 시각은 로그와 녹음이 같은 값을 쓴다
      const songStartedAt = startedAt.current ?? new Date();
      const log = buildPlayLog({
        mode: 'SHEET',
        snapshot: ss.snapshot(),
        notes: ss.notes,
        hits: recorder.current.hits,
        missSeqs: recorder.current.missSeqs,
        audioOffsetMs: ss.audioOffsetMs,
        countInMs: ss.countInMs,
        chart: ss.chart,
        inputSource,
        timing: settings.timing,
        startedAt: songStartedAt,
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
      // 녹음이 켜져 있으면 스토어가 저장 대기로 넘기고, 꺼져 있으면 무시한다. 실패해도 결과 이동은 막지 않는다
      try {
        finishSong({
          mode: 'SHEET',
          hits: recorder.current.hits,
          chart: { title: ss.chart.title, durationMs: ss.chart.durationMs },
          startedAt: songStartedAt,
          playId: log.playId,
        });
      } catch (e) {
        console.warn('녹음 확정에 실패했습니다.', e);
      }
      navigate(`/result/${log.playId}`, { replace: true });
    },
    [navigate, inputSource, settings.timing],
  );
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const resetRun = useCallback((ss: RhythmSession) => {
    recorder.current.reset();
    finishing.current = false;
    startedAt.current = new Date();
    consentAtStart.current = readCurrentConsent();
    setNoteStates(new Array<Judgement | null>(ss.notes.length).fill(null));
    setStrays([]);
    setHud(ss.snapshot());
    setSongMs(0);
    resetCountdown();
    setPauseReason(null);
  }, [resetCountdown]);

  const begin = useCallback(async () => {
    const ss = sessionRef.current;
    if (!ss || stageRef.current !== 'ready' || !readyRef.current) return;
    await unlockAudio();
    resetRun(ss);
    const st = useSettings.getState();
    coachRef.current = new LiveCoach({ goodMs: st.timing.goodMs, enabled: st.liveCoach });
    clearCoachLine();
    metronome.lock({ bpm: ss.chart.bpm, beatsPerBar: ss.chart.beatsPerBar });
    clockRef.current?.stop();
    const clock = new PlayClock(ss, {
      click: (at, accent) => audioEngine.click(at, accent),
      accompaniment: acc.state === 'ready' ? acc : undefined,
      clickOn: () => useSettings.getState().metronome,
      onBeat: (beatInBar, atMs) => metronome.pulse(beatInBar, atMs),
      onFinish: () => finishRef.current(ss),
    });
    clockRef.current = clock;
    clock.begin();
    inputManager.setCandidateProvider((t) => ss.candidates(t));
    diagSessionStart(ss, 'SHEET', { windows: useSettings.getState().timing, audioOffsetMs: useSettings.getState().audioOffsetMs });
    setPlaySession(ss);
  }, [acc, resetRun, clearCoachLine]);

  const resume = useCallback(() => {
    const clock = clockRef.current;
    // 복귀 카운트다운 중에는 pauseReason이 null이므로 일시정지 여부는 시계 상태로 본다
    if (!clock || clock.state.phase !== 'paused' || !readyRef.current) return;
    clock.resume();
    diagSessionPhase('resume');
    setPauseReason(null);
  }, []);

  // 끊김에서 복귀 → 「재연결 성공!」 1초 → 카운트다운 → 자동 재개 (PLAY-002 D9). 사용자 클릭 없음
  const { isResuming } = useReconnectResume({ pauseReason, ready, setPauseReason, setCountValue, resume, pauseTo, goMs: GO_MS });

  const restart = useCallback(() => {
    const clock = clockRef.current;
    const ss = sessionRef.current;
    if (!clock || !ss) return;
    // 재시작은 카운트인부터. 메트로놈 잠금은 유지한다
    clock.restart();
    diagSessionStart(ss, 'SHEET', { windows: useSettings.getState().timing, audioOffsetMs: useSettings.getState().audioOffsetMs });
    resetRun(ss);
    coachRef.current?.reset();
    clearCoachLine();
  }, [resetRun, clearCoachLine]);

  /** 나가기: 기록 없이 준비 화면으로(곡 선택 유지) */
  const leave = useCallback(() => {
    diagSessionEnd('left');
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    sessionRef.current?.reset();
    coachRef.current = null;
    clearCoachLine();
    resetCountdown();
    setPauseReason(null);
    setNoteStates([]);
    setStrays([]);
    setHud(null);
    setPlaySession(null);
    navigate(returnTo, { replace: true });
  }, [navigate, returnTo, resetCountdown, clearCoachLine]);

  const toSelect = useCallback(() => {
    diagSessionEnd('left');
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    clearParam();
  }, [clearParam]);

  // 연주 중(play)은 셸을 숨긴 전체 화면. 곡 선택·준비는 TopBar 제목 "악보 연습"
  useShell({ title: '악보 연습', immersive: stage === 'play' });
  // 카운트인이 끝나 곡이 진행 중일 때만 Dock이 자동으로 접힌다(일시정지·종료 시 해제)
  usePlayRunning(stage === 'play' && pauseReason === null && hud?.status === 'playing');
  // 연주 단계(카운트인·연주·일시정지·복귀 카운트다운 모두 stage 'play')에서는 녹음 스위치를 잠근다
  useEffect(() => {
    setLocked(stage === 'play');
  }, [stage]);

  // 연주 중 프레임: 세션 tick·종료 감지는 PlayClock, HUD는 4Hz
  useEffect(() => {
    if (stage !== 'play') return;
    let raf = 0;
    const loop = (now: number) => {
      const clock = clockRef.current;
      const ss = sessionRef.current;
      if (clock && ss) {
        clock.onFrame(now);
        // 카운트다운: 카운트인 동안 남은 박 수, 끝난 직후 잠깐 「시작!」
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
        if (clock.state.phase === 'running' && now - lastHud.current > HUD_INTERVAL_MS) {
          lastHud.current = now;
          setHud(ss.snapshot(now));
          setSongMs(clock.songTime());
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  // Enter / Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // D1: 처리하지 않는 경우·포커스 요소가 소유한 키는 가로채지 않는다
      if (e.isComposing || e.defaultPrevented) return;
      if (gateOpenRef.current) return;
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      if (isKeyOwnedByTarget(e.target as KeyTarget, e.code)) return;
      const st = stageRef.current;
      if (st === 'ready') {
        if (e.code === 'Enter') void begin();
        else toSelect();
      } else if (st === 'play') {
        // 일시정지 중에는 다이얼로그가 키를 소유한다(D6)
        // 복귀 카운트다운 중에는 Esc를 무시한다(일시정지 상태가 아니라 카운트다운이 끝나야 이어진다)
        if (pauseRef.current !== null || isResuming() || e.code !== 'Escape') return;
        pauseTo('user');
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [begin, toSelect, pauseTo, isResuming]);

  // 스트립이 매 프레임 읽는 곡 시각. 연주 전·후에는 null(정지)
  const getSongTime = useCallback(
    () => (stageRef.current === 'play' ? (clockRef.current?.songTime() ?? null) : null),
    [],
  );
  // 킷: 타격(hit)·판정 색, 패드 위 다음 박 배지(highlight는 넘기지 않는다 — 넘기면 next 패드까지 강조된다)
  const padStates = usePadStates(activeSession);
  const hitSeq = usePadHitSeq();
  const { badges } = useNextBeatLabels({ session: activeSession, getSongTime, enabled: settings.sheetPadCount });

  // 준비 화면: 고른 연습 단계의 최고 정확도(이 기기의 플레이 로그)
  const selectedChartId = chartIdParam ?? chart?.chartId ?? 0;
  const bestAccuracy = useMemo(
    () => (stage === 'ready' ? bestAccuracyByChart(loadPlayLogs(), 'SHEET').get(selectedChartId) : undefined),
    [stage, selectedChartId],
  );
  const presetName = presetItems.find((p) => p.id === settings.activePresetId)?.name ?? null;

  if (stage === 'loading') {
    return (
      <main className="main">
        <Card padding="md" style={{ maxWidth: 480 }}>
          <div className="col">
            {accError ? (
              <>
                <div className="notice error" role="alert">
                  {accError}
                </div>
                <div className="row">
                  {paramLoaded && (
                    <Button
                      onClick={() => {
                        acc.unload();
                        setAccResult({ loaded: paramLoaded, ok: true });
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
            ) : paramStatus === 'error' ? (
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
                <span className="dim">{accLoading ? '반주 불러오는 중' : '채보를 불러오는 중'}</span>
              </div>
            )}
          </div>
        </Card>
      </main>
    );
  }

  if (stage === 'select' || !chart || !activeSession) {
    return (
      <main className="main">
        <SongPicker mode="sheet" onSelect={param.select} />
      </main>
    );
  }

  const hasAcc = acc.state === 'ready' || acc.state === 'playing' || acc.state === 'paused';
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
          modeLabel="악보 연습"
          staffLegend
          charts={charts}
          selectedChartId={selectedChartId}
          bestAccuracy={bestAccuracy}
          ready={ready}
          missing={missing}
          connected={connected}
          keyboardOnly={settings.sensorKind === 'none'}
          pedal={pedalRequired(settings.sensorKind) ? pedalConnected({ connected: pedalPair }) : undefined}
          presetName={presetName}
          countInBars={settings.countInBars}
          onBack={toSelect}
          onSelectChart={(chartId) => {
            if (songIdParam !== null && chartId !== selectedChartId) param.select(songIdParam, chartId);
          }}
          onSetup={() => navigate('/setup', { state: { returnTo, returnLabel: `악보 연습 · ${chart.title}` } })}
          onReconnect={reconnectAvailable ? () => void reconnect() : undefined}
          onStart={() => void begin()}
          options={
            <>
              {/* 변박 곡은 지원하지 않고 안내만 한다(README 악보 연습 「격자 원점」) */}
              {chart.variableTempo && (
                <div className="notice" role="status">
                  변박 곡은 현재 지원하지 않습니다(고정 템포로 표시)
                </div>
              )}
              <PlayOptions
              metronome={settings.metronome}
              onMetronome={settings.setMetronome}
              padCount={settings.sheetPadCount}
              onPadCount={settings.setSheetPadCount}
              hasAccompaniment={hasAcc}
              accompanimentStatus={sameSong ? detail.accompanimentStatus : null}
              />
            </>
          }
        />
      </main>
    );
  }

  // 연주 중. 점수·콤보는 없고 판정 수만 보인다
  const snap = hud ?? activeSession.snapshot();

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
        variant="sheet"
        hud={
          <PlayHud
            variant="sheet"
            title={song.title}
            artist={song.artist || undefined}
            coverUrl={song.coverUrl}
            level={chart.difficulty}
            bpm={chart.bpm}
            elapsedMs={songMs}
            durationMs={chart.durationMs}
            perfect={snap.counts.PERFECT}
            good={snap.counts.GOOD}
            miss={snap.counts.MISS}
          />
        }
        area={
          <SheetPager
            chart={chart}
            noteStates={noteStates}
            strayHits={strays}
            getSongTime={getSongTime}
            countInMs={activeSession.countInMs}
          />
        }
        guide={
          coachLine ? (
            <GuideSlot mode={coachLine.mode} title={coachLine.title} />
          ) : (
            <GuideSlot mode="guide" title="악보 연습" sub="세로선에 도달한 마디를 연주하세요." />
          )
        }
        kit={<DrumKit scale={0.7} effects states={padStates} labels={false} badges={badges} skin={settings.kitSkin} hitSeq={hitSeq} />}
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

export function SheetPage() {
  const screenOk = useScreenFits();
  return (
    <>
      {/* 안내가 열린 동안 뒤 화면 전체(일시정지 다이얼로그 포함)를 inert로 — 가려진 버튼에 초점·Enter가 가지 않게 */}
      <div className="screen-gate-host" inert={!screenOk}>
        <SheetPageBody />
      </div>
      <ScreenGate open={!screenOk} />
    </>
  );
}
