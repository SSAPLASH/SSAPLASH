// 리듬 게임 (MODE-01, 설계 4-2). 곡 선택 → 준비 → 카운트인 → 플레이 → (일시정지) → 종료 → 결과.
// 엔진(RhythmSession)·레인(NoteHighway)·채보는 기존 코드. 이 페이지는 단계 전환, 입력 연결, HUD 값, 로그 저장을 맡는다.
// 화면은 Figma 연주 흐름을 조립한다: 곡 선택 SongPicker · 준비 ReadyPanel · 연주 PlayStage(HUD·하이웨이·킷). 연주 중은 셸을 숨긴 전체 화면이다(D2).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/keyTarget';
import { SongPicker } from '@/components/SongPicker';
import { useChartParam } from '@/components/useChartParam';
import { NoteHighway, type Popup } from '@/components/NoteHighway';
import { PauseOverlay, type PauseReason } from '@/components/PauseOverlay';
import { usePauseTriggers } from '@/components/usePauseTriggers';
import { useReconnectResume } from '@/components/useReconnectResume';
import { useJudgementHaptic } from '@/components/useJudgementHaptic';
import { useReadiness } from '@/components/useReadiness';
import { useRealign } from '@/components/useRealign';
import { StageFade } from '@/components/StageFade';
import { PlayStage } from '@/components/play/PlayStage';
import { kitSoundStage, type PlayStageName } from '@/components/play/kitSoundStage';
import { LazyChartAutoplayRunner } from '@/components/diag/lazyChartAutoplay';
import { PlayHud } from '@/components/play/PlayHud';
import { Countdown } from '@/components/play/Countdown';
import { countdownValue } from '@/domain/leadIn';
import { ScreenGate } from '@/components/ScreenGate';
import { useScreenFits } from '@/components/screenFit';
import { GuideSlot } from '@/components/play/GuideSlot';
import { useCoachLine } from '@/components/play/useCoachLine';
import { planCoachDisplay } from '@/components/play/coachDisplay';
import { CoachHandChip } from '@/components/play/CoachHandChip';
import { HitReadout } from '@/components/play/HitReadout';
import { ReadyPanel } from '@/components/play/ReadyPanel';
import { useSimilarSongs } from '@/components/play/useSimilarSongs';
import { RecommendRow } from '@/components/song/RecommendRow';
import { pedalConnected, pedalRequired } from '@/domain/pedalStatus';
import { DrumKit } from '@/components/drum/DrumKit';
import { createFxEmitter, judgedFxEvent, missFxEvent } from '@/components/fx/fxSource';
import { TimingBar } from '@/components/play/TimingBar';
import { strayMissSource } from '@/components/play/strayMissSource';
import { ComboDisplay } from '@/components/play/ComboDisplay';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { usePlayRunning, useShell } from '@/components/shell/useShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Chart } from '@/domain/chart';
import { artistLabel, chartFallback, sortCharts, type SongDetail } from '@/domain/songCatalog';
import { bestAccuracyByChart, EMPTY_PREV_BEST, localPrevBest, mergePrevBest, type PrevBest } from '@/domain/bestRecord';
import { useBestRecords } from '@/app/useBestRecords';
import { BestRecordsNotice } from '@/components/play/BestRecordsNotice';
import type { PadId } from '@/domain/pads';
import type { InputSourceKind } from '@/domain/events';
import { KEY_MAP } from '@/domain/keyMap';
import { presetDisplayName } from '@/domain/preset';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import { buildPlayLog, loadPlayLogs, savePlayLog } from '@/engine/playLog';
import { PlayRecorder } from '@/engine/playRecorder';
import { readCurrentConsent } from '@/app/dataConsent';
import { chartCoachContext, coachCopy, isStickSensor, LiveCoach, type CoachCopy, type CoachMessage } from '@/coach/live';
import type { CoachShadow } from '@/coach/live/shadowCoach';
import { COACH_BASIS } from '@/domain/coachBasis';
import { diagTap } from '@/engine/diagTap';
import { startPlaySync } from '@/app/playSync';
import { disarm, finishSong, setLocked } from '@/app/recordingStore';
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
type Stage = PlayStageName;

/** 개발용: 설정하면 모든 곡에 이 반주 URL을 쓴다(로컬 BE에 S3가 없을 때) */
const ACCOMPANIMENT_OVERRIDE: string | undefined = import.meta.env.VITE_ACCOMPANIMENT_OVERRIDE || undefined;

/** 카운트인이 끝난 직후 「시작!」을 보이는 시간 */
const GO_MS = 400;
/** 진단 빌드(VITE_MONITOR)에서만 코칭 그림자 평가를 켠다. 상수 분기라 미설정 빌드에는 코드가 남지 않는다 */
const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';

function parseId(raw: string | null): number | null {
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function PlayPageBody() {
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
  // 타이밍 막대 범위 밖 점: 채보 밖 타격 중 가까운 같은 패드 노트가 있는 것
  const missSource = useMemo(() => (session ? strayMissSource(session) : undefined), [session]);
  const [hud, setHud] = useState<SessionSnapshot | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  // 카운트다운 표시값(남은 박 수 · 'go' · 없음)
  const [countValue, setCountValue] = useState<number | 'go' | null>(null);
  // 리드인 앞 빈 마디 구간(숫자 없이 옅은 딤만)
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
  // 스네어 재정렬(PLAY-004 D11·D12): 연주 준비 화면과 끊김 복귀 카드에서만 세션을 연다
  const realign = useRealign(stage === 'ready' || pauseReason === 'reconnected');

  // 연주 중(play)은 셸을 숨긴 전체 화면(D2). 곡 선택·준비는 TopBar 제목 "리듬 게임"
  useShell({ title: '리듬 게임', immersive: stage === 'play' });
  // 카운트인이 끝나 곡이 진행 중일 때만 Dock이 자동으로 접힌다(일시정지·종료 시 해제)
  usePlayRunning(stage === 'play' && pauseReason === null && hud?.status === 'playing');
  // 판정 진동(PLAY-006): 연주 단계 전체(카운트인·일시정지·복귀 카운트다운 포함)에서 로컬 진동을 끄고 판정으로 울린다
  useJudgementHaptic(session, stage === 'play');
  // 연주 단계(카운트인·연주·일시정지·복귀 카운트다운 모두 stage 'play')에서는 녹음 스위치를 잠근다
  useEffect(() => {
    setLocked(stage === 'play');
  }, [stage]);

  const connected = useLive((l) => l.connected);
  const pedalPair = useLive((l) => l.pedal.connected);
  const reconnectAvailable = useReconnect((r) => r.available);
  const reconnect = useReconnect((r) => r.reconnect);
  const lastHit = useLive((l) => l.lastHit);
  const presets = usePresets((p) => p.items);
  const presetName = presetDisplayName(presets, settings.activePresetId);
  const selectSong = useSongs((s) => s.selectSong);
  const songsSource = useSongs((s) => s.source);
  // 킷 미니 뷰: 타격(hit)·판정 색
  const padStates = usePadStates(session);
  const hitSeq = usePadHitSeq();

  // 그리기 루프·입력 리스너가 최신 상태를 보도록 ref에 복사 (렌더 중 ref 쓰기 회피)
  const stageRef = useRef<Stage>(stage);
  const sessionRef = useRef<RhythmSession | null>(null);
  const pauseRef = useRef<PauseReason | null>(null);
  // 세로·좁은 화면 안내(ScreenGate)가 열려 있는지. 키 핸들러가 최신 값을 본다
  const screenOk = useScreenFits();
  const gateOpenRef = useRef(!screenOk);
  useEffect(() => {
    stageRef.current = stage;
    sessionRef.current = session;
    pauseRef.current = pauseReason;
    gateOpenRef.current = !screenOk;
  }, [stage, session, pauseReason, screenOk]);

  const flashes = useRef(new Map<PadId, number>());
  const popups = useRef<Popup[]>([]);
  // 이펙트 소스: 패드(DrumKit)와 하이웨이·타이밍 막대에 판정 이벤트를 따로 보낸다. MISS는 하이웨이 쪽으로만
  const [padFx] = useState(createFxEmitter);
  const [laneFx] = useState(createFxEmitter);
  // 타이밍 막대 눈금을 비우는 신호(새 곡·다시 시작)
  const [fxRun, setFxRun] = useState(0);
  // 결과 화면 최고 기록 비교용: 서버 스냅샷(준비 화면에서만 채움)과 연주 시작 시점에 고정한 치기 전 최고값(설계 D4)
  const serverPrevBest = useRef<PrevBest>(EMPTY_PREV_BEST);
  const prevBest = useRef<PrevBest>(EMPTY_PREV_BEST);
  const freezePrevBest = useCallback((ss: RhythmSession) => {
    const c = ss.chart;
    const local = localPrevBest(loadPlayLogs(), { mode: 'RHYTHM', songNumericId: c.songNumericId ?? null, chartId: c.chartId ?? null, songId: c.songId, difficulty: c.difficulty });
    prevBest.current = mergePrevBest(local, serverPrevBest.current);
  }, []);
  const recorder = useRef(new PlayRecorder());
  // 실시간 코칭: 곡 선택 시점에 설정값을 고정해 만든다(설계 D7). 안내 칸에 띄울 문구는 훅이 displayMs 동안 들고 있는다
  const coachRef = useRef<LiveCoach | null>(null);
  // 진단 빌드에서만 채워지는 그림자 코치(두 기준 방식 비교)
  const shadowRef = useRef<CoachShadow | null>(null);
  const { line: coachLine, show: showCoachLine, cancelPending: cancelPendingCoach, clear: clearCoachLine } = useCoachLine<CoachCopy>();
  // 일시정지하면 미루는 중이던 문구는 버린다(떠 있는 문구는 기존처럼 그대로 둔다)
  useEffect(() => {
    if (pauseReason !== null) cancelPendingCoach();
  }, [pauseReason, cancelPendingCoach]);
  const startedAt = useRef<Date | null>(null);
  const consentAtStart = useRef(false);
  const lastHud = useRef(0);
  const finishing = useRef(false);
  // 카운트 숫자를 한 번이라도 보였는지(격자 0이 되는 순간 「시작!」을 보이려고) · 「시작!」 숨김 타이머
  const wasCounting = useRef(false);
  const goTimer = useRef<number | null>(null);

  const returnTo = location.pathname + location.search;
  const clearParam = param.clear;

  const inputSource: InputSourceKind = settings.sensorKind === 'none' ? 'keyboard' : settings.sensorKind;

  const resetCountdown = useCallback(() => {
    wasCounting.current = false;
    if (goTimer.current !== null) {
      window.clearTimeout(goTimer.current);
      goTimer.current = null;
    }
    setCountValue(null);
  }, []);

  // 진입: 공용 발음을 끄고 이 페이지가 직접 소리·텔레메트리를 낸다. 떠날 때도 끈 채로 둔다(기본값, QA 352)
  useEffect(() => {
    setSoundOnHit(false);
    return () => {
      diagSessionEnd('left');
      setSoundOnHit(false);
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

  // 타격: 즉시 발음(D6) → 플래시 → 판정 → 로그·텔레메트리. 타격 진동은 스틱이 직접 울린다(PLAY-006)
  // 소리·플래시는 드럼 킷이 보이는 단계(준비·연주)에서만 낸다(QA 352). 곡 선택 중에는 어떤 입력으로 쳐도 울리지 않는다
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.pad && kitSoundStage(stageRef.current)) {
        const tAudio = audioEngine.trigger(hit.pad, hit.velocity);
        if (tAudio !== null) hit.tAudio = tAudio;
        flashes.current.set(hit.pad, performance.now());
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
      if (active) recorder.current.hit(hit, ev, ss);
      reportHit(hit, ev, active ? ss : null);
      // 이펙트(표시만): 판정·헛침·비판정 이벤트 하나를 패드와 하이웨이에 보낸다. 판정·기록 뒤라 실패해도 연주를 막지 않는다
      const fx = judgedFxEvent(hit, ev, 'game', Boolean(active));
      if (fx) {
        padFx.emit(fx);
        laneFx.emit(fx);
      }
    });
  }, [padFx, laneFx]);

  const choose = useCallback(
    (c: Chart) => {
      const ss = new RhythmSession(c, {
        windows: settings.timing,
        countInBars: settings.countInBars,
        audioOffsetMs: settings.audioOffsetMs,
      });
      // 놓침 원인 계산용 노트 맥락(직전 패드·간격). 채보마다 한 번 계산한다
      const coachContext = chartCoachContext(c.notes);
      const coach = new LiveCoach({
        goodMs: settings.timing.goodMs,
        enabled: settings.liveCoach,
        setupHints: isStickSensor(useSettings.getState().sensorKind),
        noteGapMedianMs: coachContext.noteGapMedianMs,
        onGate: MONITOR_ENABLED ? (d) => diagTap.publish({ type: 'coachGate', ...d }) : undefined,
      });
      coachRef.current = coach;
      shadowRef.current = null;
      // 진단 빌드 전용: 두 기준 방식의 문구를 그림자로 평가해 진단 녹화에 남긴다. 상수 분기라 일반 빌드에는 청크가 없다
      if (MONITOR_ENABLED) {
        const goodMs = settings.timing.goodMs;
        void import('@/coach/live/shadowCoach').then((m) => {
          if (coachRef.current !== coach) return; // 그 사이 다른 채보로 바뀐 경우
          shadowRef.current = m.createCoachShadow({
            goodMs,
            activeBasis: COACH_BASIS,
            publish: (b) => diagTap.publish({ type: 'coachEval', ...b }),
          });
        });
      }
      clearCoachLine();
      ss.onStray((s) => coach.pushStray(s.pad, s.songTimeMs));
      ss.onJudgement((e) => {
        recorder.current.judgement(e);
        // 놓친 노트 깨짐(하이웨이만). PERFECT·GOOD 이펙트는 onHit 경로에서 낸다
        const miss = missFxEvent(e, 'game');
        if (miss) laneFx.emit(miss);
        popups.current.push({ judgement: e.judgement, deltaMs: e.deltaMs, pad: e.pad, at: performance.now() });
        setHud(ss.snapshot());
        // 코칭은 기록·팝업·HUD 뒤에 한다. 변환·표시가 실패해도 플레이를 막지 않는다
        const judged = {
          songTimeMs: ss.songTime(e.at),
          noteTimeMs: ss.notes[e.noteIndex].note.timeMs,
          judgement: e.judgement,
          deltaMs: e.deltaMs,
          pad: e.pad,
          stickId: e.stickId,
          velocity: e.velocity,
          ...coachContext.notes[e.noteIndex],
        };
        // 비동기 거름의 문구는 늦게 온다. 그사이 다른 판으로 바뀌었으면 띄우지 않는다
        const show = (message: CoachMessage) => {
          if (coachRef.current !== coach) return;
          try {
            const copy = coachCopy(message, { keyboard: useSettings.getState().sensorKind === 'none' });
            if (copy) {
              // 노트가 몰린 구간이면 미루거나 구령만 띄운다. 로그 기록(coach.push)은 이미 끝났고 시점은 그대로다
              const plan = planCoachDisplay(message.tMs, ss.notes.map((n) => n.note.timeMs), 'RHYTHM');
              showCoachLine(plan.compact ? { ...copy, sub: '' } : copy, message.displayMs, plan.delayMs);
            }
          } catch {
            // 코칭 오류는 무시한다
          }
        };
        const message = coach.push(judged, ss.snapshot().strayHits, show);
        shadowRef.current?.push(judged);
        if (message) show(message);
      });
      flashes.current.clear();
      popups.current = [];
      recorder.current.reset();
      finishing.current = false;
      resetCountdown();
      setFxRun((n) => n + 1);
      setChart(c);
      setSession(ss);
      setHud(ss.snapshot());
      setPauseReason(null);
      setStage('ready');
    },
    [settings.timing, settings.countInBars, settings.audioOffsetMs, settings.liveCoach, resetCountdown, clearCoachLine, showCoachLine, laneFx],
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
    freezePrevBest(ss);
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
  }, [acc, freezePrevBest]);

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
    // 복귀 카운트다운 중(clock은 이미 정지)에 다시 끊겨도 pause 진단 기록이 두 번 남지 않게 한다
    const wasRunning = clock.state.phase === 'running';
    clock.pause(reason);
    if (wasRunning) diagSessionPhase('pause');
    // 같은 틱의 중복 트리거(끊김 + 메뉴)를 막기 위해 ref도 바로 갱신한다
    pauseRef.current = reason;
    setPauseReason(reason);
  }, []);

  // 연결 끊김·메뉴 요청 → 자동 일시정지 (설계 4-3, 8절)
  usePauseTriggers(pauseTo);

  // 연주 중(카운트다운 포함) 화면 조건이 깨지면 먼저 일시정지한다. 다시 맞아도 자동 재개하지 않는다.
  // pauseTo가 이미 멈춘 상태(pauseRef 있음)는 무시하므로 중복 호출에 안전하다
  useEffect(() => {
    if (!screenOk && stage === 'play' && pauseReason === null) pauseTo('user');
  }, [screenOk, stage, pauseReason, pauseTo]);

  const resume = useCallback(() => {
    const clock = clockRef.current;
    // 복귀 카운트다운 중에는 pauseReason이 null이므로 일시정지 여부는 시계 상태로 본다
    if (!clock || clock.state.phase !== 'paused' || !readyRef.current) return;
    clock.resume();
    diagSessionPhase('resume');
    setPauseReason(null);
  }, []);

  // 끊김에서 복귀 → 「재연결 성공!」 1초 → 카운트다운 → 자동 재개 (PLAY-002 D9). 사용자 클릭 없음
  const { isResuming } = useReconnectResume({
    pauseReason,
    ready,
    realignPending: realign.pending,
    setPauseReason,
    setCountValue,
    resume,
    pauseTo,
    goMs: GO_MS,
  });

  // 처음부터: 카운트인부터 다시. 메트로놈 잠금은 유지한다
  const restart = useCallback(() => {
    const clock = clockRef.current;
    const ss = sessionRef.current;
    if (!clock || !ss) return;
    clock.restart();
    diagSessionStart(ss, 'RHYTHM', { windows: useSettings.getState().timing, audioOffsetMs: useSettings.getState().audioOffsetMs });
    flashes.current.clear();
    popups.current = [];
    setFxRun((n) => n + 1);
    recorder.current.reset();
    coachRef.current?.reset();
    shadowRef.current?.reset();
    clearCoachLine();
    finishing.current = false;
    freezePrevBest(ss);
    startedAt.current = new Date();
    consentAtStart.current = readCurrentConsent();
    resetCountdown();
    setHud(ss.snapshot());
    setPauseReason(null);
  }, [resetCountdown, clearCoachLine, freezePrevBest]);

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
      // 곡 시작 시각은 로그와 녹음이 같은 값을 쓴다
      const songStartedAt = startedAt.current ?? new Date();
      const log = buildPlayLog({
        snapshot: ss.snapshot(),
        notes: ss.notes,
        hits: recorder.current.hits,
        missSeqs: recorder.current.missSeqs,
        audioOffsetMs: ss.audioOffsetMs,
        countInMs: ss.preRollMs,
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
          mode: 'RHYTHM',
          hits: recorder.current.hits,
          chart: { title: ss.chart.title, durationMs: ss.chart.durationMs },
          startedAt: songStartedAt,
          playId: log.playId,
        });
      } catch (e) {
        console.warn('녹음 확정에 실패했습니다.', e);
      }
      navigate(`/result/${log.playId}`, { state: { prevBest: prevBest.current } });
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
      // 카운트다운(설계 MODE-001-lead-in-bars D16·D17): 격자 시각(곡 시각 − 1마디 1박 원점) 기준으로 준비 마디 시작까지 5·4·3·2·1,
      // 그 뒤 1마디 준비 구간은 오버레이 없이(불 켜짐) 두고 격자 0에서 「시작!」. 일시정지·재연결 복귀 카운트다운 중에는 값을 건드리지 않는다
      const status = ss.currentStatus;
      if ((status === 'countin' || status === 'playing') && !isResuming()) {
        const g = ss.songTime(now) - ss.originMs;
        const c = countdownValue(g, ss.countInMs);
        if (c !== null) {
          wasCounting.current = true;
          setCountValue(c);
        } else if (g >= 0) {
          if (wasCounting.current) {
            wasCounting.current = false;
            setCountValue('go');
            goTimer.current = window.setTimeout(() => {
              goTimer.current = null;
              setCountValue(null);
            }, GO_MS);
          }
        } else {
          setCountValue(null);
        }
      }
      if (now - lastHud.current > 250) {
        lastHud.current = now;
        setHud(ss.snapshot(now));
      }
    },
    [finish, isResuming],
  );

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

  // 준비 화면은 선택 chartId의 서버 기록, 내장 개발 소스만 로컬 기록을 쓴다.
  const selectedChartId = chartIdParam ?? chart?.chartId ?? 0;
  // 연주 준비의 "이 곡과 비슷한 곡"(설계 COACH-004-similar-songs): 준비 단계 진입 시 곡당 1회, 카드는 선택 단계를 따라간다
  const similar = useSimilarSongs({
    songId: songIdParam,
    active: stage === 'ready' && param.status === 'ready',
    difficulty: chart?.difficulty ?? null,
    onSelect: param.select,
  });
  const records = useBestRecords(
    stage !== 'select' && songIdParam !== null ? [songIdParam] : [],
    'RHYTHM', stage === 'ready' && detail?.id === songIdParam, songsSource,
  );
  const localBestAccuracy = useMemo(
    () => (songsSource === 'builtin' && stage === 'ready' ? bestAccuracyByChart(loadPlayLogs(), 'RHYTHM').get(selectedChartId) : undefined),
    [songsSource, stage, selectedChartId],
  );
  const bestAccuracy = songsSource === 'builtin' ? localBestAccuracy : records.accuraciesByChart.get(selectedChartId);
  // 준비 화면 동안만 서버 최고 점수를 담아 둔다(연주 중에는 조회가 꺼져 비므로 시작 때 고정한 값을 쓴다, U4)
  const serverBestScore = songIdParam === null ? undefined : records.scoresBySong.get(songIdParam);
  useEffect(() => {
    if (stage === 'ready') serverPrevBest.current = { score: serverBestScore ?? null, accuracy: null };
  }, [stage, serverBestScore]);

  // 260번: 숨긴 연습 단계(노트가 NORMAL과 같아 곡 응답에서 빠진 채보)의 id가 URL에 남아 있으면(예전 링크·새로고침)
  // 기본 단계로 바꾼다. 사용자가 고른 것이 아니므로 방문 기록을 쌓지 않는다. 연주 중에는 바꾸지 않는다
  const selectParam = param.select;
  useEffect(() => {
    if (stage !== 'ready' || songIdParam === null || chartIdParam === null || detail === null || detail.id !== songIdParam) return;
    const fallback = chartFallback(detail, chartIdParam);
    if (fallback !== null) selectParam(songIdParam, fallback, { replace: true });
  }, [stage, songIdParam, chartIdParam, detail, selectParam]);

  // 불러오는 중·오류. 연습 단계를 바꿔 다시 불러올 때도 이 카드로 돌아온다
  if (stage === 'loading') {
    return (
      <StageFade stageKey="loading">
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
      </StageFade>
    );
  }

  if (stage === 'select' || !chart || !session) {
    return (
      <StageFade stageKey="select">
        <main className="main">
          <SongPicker mode="play" onSelect={param.select} />
        </main>
      </StageFade>
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
      <StageFade stageKey="ready">
        <main className="main">
          <BestRecordsNotice status={records.status} retry={records.retry} />
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
            pedal={pedalRequired(settings.sensorKind) ? pedalConnected({ connected: pedalPair }) : undefined}
            presetName={presetName}
            countInBars={settings.countInBars}
            onBack={toSelect}
            onSelectChart={(chartId) => {
              if (songIdParam !== null && chartId !== selectedChartId) param.select(songIdParam, chartId);
            }}
            onSetup={() => navigate('/setup', { state: { returnTo, returnLabel: `리듬 게임 · ${chart.title}` } })}
            onReconnect={reconnectAvailable ? () => void reconnect() : undefined}
            onStart={() => void begin()}
            realign={realign.info}
            footer={similar.cards.length > 0 ? <RecommendRow caption="이 곡과 비슷한 곡" items={similar.cards} onPick={similar.onPick} /> : undefined}
          />
        </main>
      </StageFade>
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
        realign={realign.info}
      />
    );
  } else if (countValue !== null) {
    // 재연결 복귀 카운트다운은 기존 딤(dim), 곡 시작 카운트다운 숫자는 옅은 딤(soft), 「시작!」에서 딤이 걷힌다(clear, 같은 요소 유지)
    overlay = <Countdown value={countValue} backdrop={isResuming() || countValue !== 'go' ? 'dim' : 'clear'} />;
  }

  return (
    <main>
      <PlayStage
        variant="game"
        hud={
          <PlayHud
            variant="game"
            title={song.title}
            artist={artistLabel(song.artist)}
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
            fxSource={laneFx.source}
            topOverlay={<ComboDisplay combo={snap.combo} judgement={snap.last?.judgement ?? null} at={snap.last?.at ?? null} />}
            overlay={
              settings.timingBar ? (
                <TimingBar source={laneFx.source} perfectMs={settings.timing.perfectMs} goodMs={settings.timing.goodMs} resetToken={fxRun} missSource={missSource} />
              ) : undefined
            }
          />
        }
        // 코칭 모드는 구령(제목)+보조 두 줄. 라벨은 화면에서 감춘다(play.css, 칸 51px 안)
        guide={
          coachLine ? (
            <GuideSlot mode={coachLine.mode} title={coachLine.title} sub={coachLine.sub} />
          ) : (
            <GuideSlot mode="guide" title="노트에 맞춰 연주" sub="판정선에 노트가 닿을 때 타격하세요." />
          )
        }
        kit={
          <div className="coach-kit">
            <DrumKit
              scale={0.7}
              effects
              states={padStates}
              labels={false}
              skin={settings.kitSkin}
              hitSeq={hitSeq}
              fxSource={padFx.source}
              coachPad={coachLine?.target?.kind === 'pad' ? coachLine.target.pad : undefined}
            />
            {coachLine?.target?.kind === 'hand' && <CoachHandChip hand={coachLine.target.hand} />}
          </div>
        }
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
      {/* 진단 빌드 전용: 채보 확인 재생(T2) */}
      {LazyChartAutoplayRunner && (
        <Suspense fallback={null}>
          <LazyChartAutoplayRunner clockRef={clockRef} session={session} />
        </Suspense>
      )}
    </main>
  );
}

export function PlayPage() {
  const screenOk = useScreenFits();
  return (
    <>
      {/* 안내가 열린 동안 뒤 화면 전체(일시정지 다이얼로그 포함)를 inert로 — 가려진 버튼에 초점·Enter가 가지 않게 */}
      <div className="screen-gate-host" inert={!screenOk}>
        <PlayPageBody />
      </div>
      <ScreenGate open={!screenOk} />
    </>
  );
}
