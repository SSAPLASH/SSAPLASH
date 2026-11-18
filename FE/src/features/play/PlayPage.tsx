// 리듬 게임 (MODE-01, 설계 4-2, 설계 MODE-001-play-quick-start v0.2). 곡 선택 → (시작 대기: 채보·반주 불러오기) → 카운트인 → 플레이 → (일시정지) → 종료 → 결과.
// 엔진(RhythmSession)·레인(NoteHighway)·채보는 기존 코드. 이 페이지는 단계 전환, 입력 연결, HUD 값, 로그 저장을 맡는다.
// 준비 화면·시작 확인 창은 없다 — 카드의 [▶ 플레이]를 누르면 기기가 준비된 경우 바로 카운트다운으로 들어간다(E3).
// 팝업(StartDialog, 옵션 줄 없음)은 기기 준비가 안 됐거나 불러오기에 실패했거나 스네어 재정렬이 걸렸을 때만 뜬다(E5·E6·E8).
// 시작 대기(`startTarget`)는 화면 안 상태다 — 주소에는 `?song=&chart=`만 싣고 `start`는 쓰지 않는다(E7). 반주가 있는 곡은 항상 반주를 재생한다.
// 결과 화면의 [다시 하기]는 `location.state.autoStart`로 들어와 곡 선택을 거치지 않고 같은 곡·단계의 카운트다운으로 바로 간다.
// 게임은 곡 중 메트로놈 클릭이 없고(카운트다운 박 소리만) 녹음하지 않는다(E1·E2). 연주 중은 셸을 숨긴 전체 화면이다(D2).
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/kit/keyTarget';
import { SongPicker } from '@/features/play/components/picker/SongPicker';
import { useChartParam } from '@/features/play/components/picker/useChartParam';
import { NoteHighway, type Popup } from '@/features/play/components/stage/highway/NoteHighway';
import { PauseOverlay, type PauseReason } from '@/features/play/components/pause/PauseOverlay';
import { usePauseTriggers } from '@/features/play/components/pause/usePauseTriggers';
import { useSpacePause } from '@/features/play/components/pause/useSpacePause';
import { useReconnectResume } from '@/features/play/components/pause/useReconnectResume';
import { useJudgementHaptic } from '@/features/play/components/stage/useJudgementHaptic';
import { useReadiness } from '@/features/play/components/start/useReadiness';
import { useRealign } from '@/components/calibration/useRealign';
import { StageFade } from '@/features/play/components/stage/StageFade';
import { PlayStage } from '@/features/play/components/stage/PlayStage';
import { kitSoundStage, type PlayStageName } from '@/features/play/components/stage/kit/kitSoundStage';
import { LazyChartAutoplayRunner } from '@/features/play/components/diag/lazyChartAutoplay';
import { PlayHud } from '@/features/play/components/stage/PlayHud';
import { AudioWaitNotice } from '@/features/play/components/stage/AudioWaitNotice';
import { Countdown } from '@/features/play/components/stage/Countdown';
import { useAudioClockGate } from '@/features/play/components/stage/useAudioClockGate';
import { countdownValue } from '@/domain/time/leadIn';
import { ScreenGate } from '@/features/play/components/stage/ScreenGate';
import { useScreenFits } from '@/features/play/components/stage/screenFit';
import { GuideSlot } from '@/features/play/components/stage/GuideSlot';
import { useCoachLine } from '@/features/play/components/stage/coach/useCoachLine';
import { planCoachDisplay } from '@/features/play/components/stage/coach/coachDisplay';
import { CoachHandChip } from '@/features/play/components/stage/coach/CoachHandChip';
import { HitReadout } from '@/features/play/components/stage/HitReadout';
import { StartDialog } from '@/features/play/components/start/StartDialog';
import { pedalConnected, pedalRequired } from '@/domain/kit/device/pedalStatus';
import { visualPadOf } from '@/domain/kit/drumKit';
import { LaneLinkLayer, type GuideLevel } from '@/features/play/components/stage/link/LaneLinkLayer';
import { useGameKitScale } from '@/features/play/components/stage/link/useGameKitScale';
import { useNextBeatLabels } from '@/features/play/components/stage/useNextBeatLabels';
import { LiveDrumKit } from '@/components/drum/LiveDrumKit';
import { createFxEmitter, judgedFxEvent, missFxEvent } from '@/components/fx/fxSource';
import { TimingBar } from '@/features/play/components/stage/TimingBar';
import { strayMissSource } from '@/features/play/components/stage/strayMissSource';
import { ComboDisplay } from '@/features/play/components/stage/ComboDisplay';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { useDock, usePlayRunning, useShell } from '@/components/shell/nav/useShell';
import type { Chart } from '@/domain/song/chart';
import { artistLabel, chartFallback, type SongDetail } from '@/domain/song/songCatalog';
import { EMPTY_PREV_BEST, localPrevBest, prevBestFor, type PrevBest } from '@/domain/play/bestRecord';
import { useBestRecords } from './useBestRecords';
import type { PadId } from '@/domain/kit/pads';
import { isSensorSource, type InputSourceKind } from '@/domain/events';
import { appliedWindows } from '@/domain/play/judgement';
import { isBeginnerChart } from '@/domain/play/lesson';
import { GO_MS, NO_LESSONS, parseId } from '@/features/play/domain/playShared';
import { useLessons } from '@/store/lessonStore';
import { KEY_MAP } from '@/domain/kit/keyMap';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import { buildPlayLog, loadPlayLogs, savePlayLog } from '@/engine/playLog';
import { PlayRecorder } from './playRecorder';
import { readCurrentConsent } from './dataConsent';
import { chartCoachContext, chooseCoachModel, coachCopy, isStickSensor, LiveCoach, LlmCoach, refreshCoachModels, type CoachCopy, type CoachMessage } from '@/coach/live';
import { liveCoachClient } from '@/features/play/api/liveCoach';
import { useAuth } from '@/store/authStore';
import type { CoachShadow } from '@/features/play/coach/shadowCoach';
import { COACH_BASIS } from '@/domain/play/coachBasis';
import { diagTap } from '@/engine/diagTap';
import { startPlaySync } from '@/runtime/playSync';
import { diagSessionEnd, diagSessionPhase, diagSessionStart, reportHit } from '@/engine/diagReport';
import { kickOffsetOrStick } from '@/domain/kit/calibration/timingCalibration';
import { diagSessionOpts } from './diagSessionOpts';
import { useTimingCalGate } from './useTimingCalGate';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/runtime/sources';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { unlockAudio } from '@/runtime/audioUnlock';
import { audioEngine } from '@/audio/AudioEngine';
import { Accompaniment } from '@/audio/Accompaniment';
import { PlayClock } from './sessionClock';
import { metronome } from '@/engine/Metronome';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { clockSkewText } from '@/domain/kit/device/arrivalSkew';
import { liveAimSource } from './liveAim';
import { useReconnect } from '@/store/reconnectStore';
import { useSongs, type LoadedChart } from '@/store/songStore';

// 단계는 URL 파라미터 상태·세션에서 렌더 중 파생한다. paused는 pauseReason으로 표시
type Stage = PlayStageName;
/** 하이웨이 위에 겹쳐 뜨는 HUD가 덮는 높이(px, PlayStage.css의 HUD 위 여백 8 + 높이 96). 레인 이름·콤보를 그 아래로 내린다 */
const GAME_HUD_INSET = 104;

/** 개발용: 설정하면 모든 곡에 이 반주 URL을 쓴다(로컬 BE에 S3가 없을 때) */
const ACCOMPANIMENT_OVERRIDE: string | undefined = import.meta.env.VITE_ACCOMPANIMENT_OVERRIDE || undefined;

/** 진단 빌드(VITE_MONITOR)에서만 코칭 그림자 평가를 켠다. 상수 분기라 미설정 빌드에는 코드가 남지 않는다 */
const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';

/** 반주 디코드 결과. loaded가 현재 URL 파라미터의 결과와 같을 때만 유효하다 */
interface AccResult {
  loaded: LoadedChart;
  ok: boolean;
  error?: string;
}

function PlayPageBody() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  // 킷은 설정의 드럼 모양과 무관하게 네온이다(레인 색과 같은 3색). 배율은 화면 높이에 따라 0.6 / 0.7
  const kitScale = useGameKitScale();
  const [searchParams] = useSearchParams();
  // 연주 중인 세션. 연주 중 설정이 바뀌어도 세션을 새로 만들지 않도록 begin 때 고정한다
  const [playSession, setPlaySession] = useState<RhythmSession | null>(null);
  // 시작 대기: [▶ 플레이]를 누른 뒤 카운트다운에 들어가기 전까지(화면 안 상태, 주소에 싣지 않는다). 채보·반주는 이때부터(연주 중에도) 읽는다.
  // 시작하려는 곡·단계를 함께 기억한다 — 주소가 그 곡·단계로 바뀐 뒤에만 읽기 시작해야, 주소에 남아 있던 이전 곡으로 시작하지 않는다.
  // [다시 하기]로 들어왔으면(state.autoStart) 주소의 곡·단계로 바로 시작 대기에 들어간다
  const [startTarget, setStartTarget] = useState<{ song: number; chart: number } | null>(() => {
    const song = parseId(searchParams.get('song'));
    const chart = parseId(searchParams.get('chart'));
    const auto = (location.state as { autoStart?: boolean } | null)?.autoStart === true;
    return auto && song !== null && chart !== null ? { song, chart } : null;
  });
  // 새로고침·뒤로 가기로 다시 자동 시작하지 않도록 도착 state를 비운다
  useEffect(() => {
    if ((location.state as { autoStart?: boolean } | null)?.autoStart) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
    // 도착 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 시작 대기 중 팝업이 한 번이라도 떴는가. 떴으면 기기가 이어져도 자동 시작하지 않고 팝업의 [▶ 플레이]를 기다린다(E6)
  const [popupSeen, setPopupSeen] = useState(false);
  const songIdParam = parseId(searchParams.get('song'));
  const chartIdParam = parseId(searchParams.get('chart'));
  const startOpen = startTarget !== null && songIdParam === startTarget.song && chartIdParam === startTarget.chart;
  const param = useChartParam({ enabled: startOpen || playSession !== null });
  const { status: paramStatus, loaded: paramLoaded } = param;
  const [hud, setHud] = useState<SessionSnapshot | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  // 카운트다운 표시값(남은 박 수 · 'go' · 없음)
  const [countValue, setCountValue] = useState<number | 'go' | null>(null);
  // 곡 상세(커버·가수·연습 단계 목록). 시작 확인 창·연주 화면이 쓴다
  const [detail, setDetail] = useState<SongDetail | null>(null);
  const [acc] = useState(() => new Accompaniment(audioEngine));
  const [accResult, setAccResult] = useState<AccResult | null>(null);
  const clockRef = useRef<PlayClock | null>(null);
  // 준비 조건 미충족이면 시작하지 못한다(키보드 전용은 면제). 키 핸들러·begin이 최신 값을 보도록 ref에도 둔다
  const { ready, missing } = useReadiness();
  // 서버 코칭 모델·실험 설정을 미리 받아 둔다. 못 받으면 빌드 기본값으로 동작한다
  useEffect(() => {
    void refreshCoachModels();
  }, []);
  const readyRef = useRef(ready);
  // begin()이 읽는 ref는 화면을 그리기 전에 맞춘다(useEffect면 ▶ 플레이가 보인 직후 누른 클릭이 옛 값을 보고 무시될 수 있다)
  useLayoutEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // 반주 URL: 개발 override > 자산. 없으면 반주 없이 클릭만. 게임은 반주를 끄는 옵션이 없어 있으면 항상 불러온다
  const accUrl = paramLoaded ? (ACCOMPANIMENT_OVERRIDE ?? paramLoaded.assets?.accompanimentUrl ?? null) : null;
  const accCurrent = accResult && accResult.loaded === paramLoaded ? accResult : null;
  const accError = accUrl !== null && accCurrent && !accCurrent.ok ? (accCurrent.error ?? '반주를 불러오지 못했습니다.') : null;
  const readyChart: Chart | null = paramLoaded && (accUrl === null || accCurrent?.ok) ? paramLoaded.chart : null;

  // 판정 폭: 쉬운 채보·입문 코스 연주 레슨이면 GOOD을 넓힌다(PLAY-004 3-5). 세션·타이밍 막대·진단 줄·플레이 로그가 이 값 하나를 쓴다
  const lessons = useLessons((l) => l.list)?.items ?? NO_LESSONS;
  const beginner = readyChart ? isBeginnerChart({ difficulty: readyChart.difficulty, chartId: readyChart.chartId, lessons }) : false;
  const windows = useMemo(() => appliedWindows(settings.timing, beginner), [settings.timing, beginner]);
  const widened = beginner && windows.goodMs > settings.timing.goodMs;

  // 시작 확인 창이 열린 동안의 세션. 설정이 바뀌면 이 단계에서만 새로 만든다
  const session = useMemo(
    () =>
      readyChart
        ? new RhythmSession(readyChart, {
            windows,
            countInBars: settings.countInBars,
            audioOffsetMs: settings.audioOffsetMs,
            kickOffsetMs: kickOffsetOrStick(settings.audioOffsetMs, settings.kickOffsetMs),
          })
        : null,
    [readyChart, windows, settings.countInBars, settings.audioOffsetMs, settings.kickOffsetMs],
  );
  const activeSession = playSession ?? session;
  // 타이밍 막대 범위 밖 점: 채보 밖 타격 중 가까운 같은 패드 노트가 있는 것
  const missSource = useMemo(() => (activeSession ? strayMissSource(activeSession) : undefined), [activeSession]);
  const chart = activeSession?.chart ?? null;
  const stage: Stage = playSession ? 'play' : !startOpen ? 'select' : session ? 'ready' : 'loading';
  // 스네어 재정렬(PLAY-004 D11·D12): 시작 대기 중과 끊김 복귀 카드에서만 세션을 연다
  const realign = useRealign(startOpen || pauseReason === 'reconnected');

  // 연주 중(play)은 셸을 숨긴 전체 화면(D2). 곡 선택·시작 확인 창은 TopBar 제목 "리듬 게임"
  useShell({ title: '리듬 게임', immersive: stage === 'play' });
  // 카운트인이 끝나 곡이 진행 중일 때만 Dock이 자동으로 접힌다(일시정지·종료 시 해제)
  usePlayRunning(stage === 'play' && pauseReason === null && hud?.status === 'playing');
  // 판정 진동(PLAY-006): 연주 단계 전체(카운트인·일시정지·복귀 카운트다운 포함)에서 로컬 진동을 끄고 판정으로 울린다
  useJudgementHaptic(activeSession, stage === 'play');
  // 키보드 드럼은 연주 단계에서만 받는다(곡 선택·시작 확인 창에서는 키를 가로채지 않는다)
  useKeyboardDrum(stage === 'play');
  // Dock도 연주 단계(카운트인·일시정지 포함)에서만 둔다. 곡 선택·시작 확인 창에는 없다(QA 352 Q8)
  useDock(stage === 'play');

  const connected = useLive((l) => l.connected);
  const clockSkew = useLive((l) => l.clockSkew);
  const pedalPair = useLive((l) => l.pedal.connected);
  const reconnectAvailable = useReconnect((r) => r.available);
  const reconnect = useReconnect((r) => r.reconnect);
  const lastHit = useLive((l) => l.lastHit);
  const selectSong = useSongs((s) => s.selectSong);
  const songsSource = useSongs((s) => s.source);
  // 킷 미니 뷰: 타격(hit)·판정 색
  const padStates = usePadStates(activeSession);
  const hitSeq = usePadHitSeq();
  // 가이드(설정 gameGuide): 악보 연습과 같은 「다음 칠 박 번호」를 패드 배지와 레인 → 패드 점선으로 보인다
  const getGuideTime = useCallback(() => (stageRef.current === 'play' ? (clockRef.current?.songTime() ?? null) : null), []);
  const { badges: nextBadges } = useNextBeatLabels({ session: activeSession, getSongTime: getGuideTime, enabled: settings.gameGuide });
  const guideLevels = useMemo(() => {
    if (!settings.gameGuide) return undefined;
    const m: Partial<Record<PadId, GuideLevel>> = {};
    for (const [pad, b] of Object.entries(nextBadges)) if (b) m[pad as PadId] = b.level;
    return m;
  }, [nextBadges, settings.gameGuide]);
  // 네온 킷에는 페달 패드가 없어 페달 배지는 하이햇 패드에 붙인다(하이햇 배지가 있으면 그쪽이 우선)
  const guideBadges = useMemo(() => {
    const m = { ...nextBadges };
    for (const [pad, b] of Object.entries(nextBadges)) {
      const v = visualPadOf(pad as PadId);
      if (b && v && v !== pad && !m[v]) m[v] = b;
    }
    return m;
  }, [nextBadges]);

  // 그리기 루프·입력 리스너가 최신 상태를 보도록 ref에 복사 (렌더 중 ref 쓰기 회피)
  const stageRef = useRef<Stage>(stage);
  const sessionRef = useRef<RhythmSession | null>(null);
  const pauseRef = useRef<PauseReason | null>(null);
  // 세로·좁은 화면 안내(ScreenGate)가 열려 있는지. 키 핸들러가 최신 값을 본다
  const screenOk = useScreenFits();
  const gateOpenRef = useRef(!screenOk);
  // 위 readyRef와 같은 이유로 그리기 전에 맞춘다
  useLayoutEffect(() => {
    stageRef.current = stage;
    sessionRef.current = activeSession;
    pauseRef.current = pauseReason;
    gateOpenRef.current = !screenOk;
  }, [stage, activeSession, pauseReason, screenOk]);

  const flashes = useRef(new Map<PadId, number>());
  const popups = useRef<Popup[]>([]);
  // 이펙트 소스: 패드(DrumKit)와 하이웨이·타이밍 막대에 판정 이벤트를 따로 보낸다. MISS는 하이웨이 쪽으로만
  const [padFx] = useState(createFxEmitter);
  const [laneFx] = useState(createFxEmitter);
  // 타이밍 막대 눈금을 비우는 신호(새 곡·다시 시작)
  const [fxRun, setFxRun] = useState(0);
  // 결과 화면 최고 기록 비교용: 서버 스냅샷(시작 확인 창이 열린 동안에만 채움)과 연주 시작 시점에 고정한 치기 전 최고값(설계 D4)
  const serverPrevBest = useRef<PrevBest>(EMPTY_PREV_BEST);
  const prevBest = useRef<PrevBest>(EMPTY_PREV_BEST);
  const freezePrevBest = useCallback((ss: RhythmSession) => {
    const c = ss.chart;
    const local = localPrevBest(loadPlayLogs(), { mode: 'RHYTHM', songNumericId: c.songNumericId ?? null, chartId: c.chartId ?? null, songId: c.songId, difficulty: c.difficulty, goodMs: ss.windows.goodMs });
    prevBest.current = prevBestFor(local, serverPrevBest.current, ss.windows.goodMs);
  }, []);
  const recorder = useRef(new PlayRecorder());
  // 실시간 코칭: 연주를 시작할 때 설정값을 고정해 만든다(설계 D7). 안내 칸에 띄울 문구는 훅이 displayMs 동안 들고 있는다
  const coachRef = useRef<LiveCoach | null>(null);
  // 진단 빌드에서만 채워지는 그림자 코치(두 기준 방식 비교)
  const shadowRef = useRef<CoachShadow | null>(null);
  // 연주 중 LLM 구간 코칭 요청기. 다시 하기·종료·화면 이탈 때 기다리던 결과를 버린다
  const llmRef = useRef<LlmCoach | null>(null);
  useEffect(() => () => llmRef.current?.cancel(), []);
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
  const inputSource: InputSourceKind = settings.sensorKind === 'none' ? 'keyboard' : settings.sensorKind;
  // 첫 연주 전 박자 맞추기 권유(PLAY-004 4-3). 시작 확인 창 없이 곡 선택에서 바로 시작한 경우에는 닫을 때 시작 대기를 풀어 곡 선택으로 돌린다
  const popupOpenRef = useRef(false);
  const { gate: timingGate, dialog: timingDialog, open: timingOpen } = useTimingCalGate({
    isSensor: () => isSensorSource(inputSource),
    onClosed: () => {
      if (!popupOpenRef.current) setStartTarget(null);
    },
  });

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
        // 상세 없이도 시작·연주는 가능하다
      },
    );
    return () => {
      cancelled = true;
    };
  }, [songIdParam, selectSong]);

  // 반주는 시작 대기가 되면 디코드해 둔다. URL이 바뀌면(다른 곡) 이전 로드는 취소한다
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

  // 비동기 거름·LLM 구간 문구는 늦게 온다. 그사이 다른 판으로 바뀌었으면 띄우지 않는다
  const showCoachMessage = useCallback(
    (coach: LiveCoach, ss: RhythmSession, message: CoachMessage) => {
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
    },
    [showCoachLine],
  );

  // 판정 → 팝업·HUD·코칭. 세션이 바뀌면 다시 건다
  useEffect(() => {
    if (!activeSession) return;
    // 놓침 원인 계산용 노트 맥락(직전 패드·간격). 세션마다 한 번 계산한다
    const coachContext = chartCoachContext(activeSession.chart.notes);
    const offStray = activeSession.onStray((s) => coachRef.current?.pushStray(s.pad, s.songTimeMs, s.stickId, s.pose));
    const offJudgement = activeSession.onJudgement((e) => {
      recorder.current.judgement(e);
      // 놓친 노트 깨짐(하이웨이만). PERFECT·GOOD 이펙트는 onHit 경로에서 낸다
      const miss = missFxEvent(e, 'game');
      if (miss) laneFx.emit(miss);
      popups.current.push({ judgement: e.judgement, deltaMs: e.deltaMs, pad: e.pad, at: performance.now() });
      setHud(activeSession.snapshot());
      // 코칭은 기록·팝업·HUD 뒤에 한다. 변환·표시가 실패해도 플레이를 막지 않는다
      const coach = coachRef.current;
      if (!coach) return;
      const judged = {
        songTimeMs: activeSession.songTime(e.at),
        noteTimeMs: activeSession.notes[e.noteIndex].note.timeMs,
        judgement: e.judgement,
        deltaMs: e.deltaMs,
        pad: e.pad,
        stickId: e.stickId,
        velocity: e.velocity,
        pose: e.pose,
        ...coachContext.notes[e.noteIndex],
      };
      const message = coach.push(judged, activeSession.snapshot().strayHits, (m) => showCoachMessage(coach, activeSession, m));
      shadowRef.current?.push(judged);
      if (message) showCoachMessage(coach, activeSession, message);
    });
    return () => {
      offStray();
      offJudgement();
    };
  }, [activeSession, laneFx, showCoachMessage]);

  // 타격: 즉시 발음(D6) → 플래시 → 판정 → 로그·텔레메트리. 타격 진동은 스틱이 직접 울린다(PLAY-006)
  // 소리·플래시는 드럼 킷이 보이는 단계(시작 확인 창·연주)에서만 낸다(QA 352). 곡 선택 중에는 어떤 입력으로 쳐도 울리지 않는다
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

  // 새 판(처음·다시 시작) 초기화: 기록·팝업·카운트다운을 비우고 이번 판의 치기 전 최고값을 고정한다
  const resetRun = useCallback(
    (ss: RhythmSession) => {
      flashes.current.clear();
      popups.current = [];
      recorder.current.reset();
      finishing.current = false;
      freezePrevBest(ss);
      startedAt.current = new Date();
      consentAtStart.current = readCurrentConsent();
      setFxRun((n) => n + 1);
      setHud(ss.snapshot());
      resetCountdown();
      setPauseReason(null);
    },
    [freezePrevBest, resetCountdown],
  );

  // 시작·재개·처음부터 전에 오디오 시계가 실제로 흐를 때까지 기다린다(설계 MODE-001 오디오 시계 시작 대기).
  // 출력을 막 깨운 직후에 시계를 움직이면 카운트인 클릭이 몰리고 반주가 곡 내내 늦는다
  const { notice: audioWaiting, wait: waitAudioClock } = useAudioClockGate();

  const begin = useCallback(async (): Promise<boolean> => {
    const ss = sessionRef.current;
    if (!ss || stageRef.current !== 'ready' || !readyRef.current) return false;
    await unlockAudio();
    // 기다리는 사이 나갔거나 곡·준비 조건이 바뀌었으면 시작하지 않는다
    if (!(await waitAudioClock('begin'))) return false;
    if (sessionRef.current !== ss || stageRef.current !== 'ready' || !readyRef.current) return false;
    resetRun(ss);
    const st = useSettings.getState();
    // 놓침 원인 계산용 노트 맥락(직전 패드·간격)
    const coachContext = chartCoachContext(ss.chart.notes);
    // 서버 실험 설정이 있으면 실험군의 모델을 쓴다. 로그인 사용자는 같은 실험군에 남는다
    const model = chooseCoachModel(useAuth.getState().user?.id ?? null);
    // 연주 중 LLM 구간 코칭(실험 설정 llm, 로그인 사용자만). 구간이 끝나면 BE에 요청하고 기한 안의 문구만 띄운다
    const llmMode = st.liveCoach ? model.llm : null;
    let llm: LlmCoach | null = null;
    const coach = new LiveCoach({
      goodMs: ss.windows.goodMs,
      enabled: st.liveCoach,
      setupHints: isStickSensor(st.sensorKind),
      noteGapMedianMs: coachContext.noteGapMedianMs,
      onGate: MONITOR_ENABLED ? (d) => diagTap.publish({ type: 'coachGate', ...d }) : undefined,
      gate: model.gate,
      gateMode: model.mode,
      arm: model.arm,
      causeModel: model.cause,
      causeArm: model.causeArm,
      llmArm: model.llmArm,
      segments: llmMode
        ? { chart: ss.chart, input: st.sensorKind === 'none' ? 'keyboard' : 'stick', onSegment: (seg) => void llm?.submit(seg), aim: liveAimSource() }
        : undefined,
    });
    llmRef.current?.cancel();
    if (llmMode) {
      llm = new LlmCoach({
        client: liveCoachClient(),
        mode: llmMode,
        runId: crypto.randomUUID(),
        onTip: (tip) => {
          const message = coach.offerLlmTip(tip, ss.songTime(performance.now()));
          if (message) showCoachMessage(coach, ss, message);
        },
        onRecord: (r) => coach.recordLlm(r, ss.songTime(performance.now())),
      });
    }
    llmRef.current = llm;
    // 다음 연주를 위해 다시 받는다(매니페스트의 current를 바꾸면 다음 연주부터 반영)
    void refreshCoachModels();
    coachRef.current = coach;
    shadowRef.current = null;
    // 진단 빌드 전용: 두 기준 방식의 문구를 그림자로 평가해 진단 녹화에 남긴다. 상수 분기라 일반 빌드에는 청크가 없다
    if (MONITOR_ENABLED) {
      const goodMs = ss.windows.goodMs;
      void import('@/features/play/coach/shadowCoach').then((m) => {
        if (coachRef.current !== coach) return; // 그 사이 나가거나 다시 시작한 경우
        shadowRef.current = m.createCoachShadow({
          goodMs,
          activeBasis: COACH_BASIS,
          publish: (b) => diagTap.publish({ type: 'coachEval', ...b }),
        });
      });
    }
    clearCoachLine();
    metronome.lock({ bpm: ss.chart.bpm, beatsPerBar: ss.chart.beatsPerBar });
    clockRef.current?.stop();
    const clock = new PlayClock(ss, {
      click: (at, level) => audioEngine.click(at, level),
      accompaniment: acc.state === 'ready' ? acc : undefined,
      // 게임은 곡 중 클릭을 내지 않는다(E1). 카운트다운 박 소리는 PlayClock이 clickOn과 무관하게 항상 낸다
      clickOn: () => false,
      onBeat: (beatInBar, atMs) => metronome.pulse(beatInBar, atMs),
      audioClock: () => audioEngine.clockReading(),
      // 반주·클릭을 오디오 시계에 바로 예약하고 곡 시각을 들리는 오디오 시각에서 계산한다(설계 MODE-001 연주 시계를 오디오 시계 하나로)
      audioReading: () => audioEngine.audioReading(),
      clickAt: (ctxSec, level) => audioEngine.clickAtContext(ctxSec, level),
    });
    clockRef.current = clock;
    clock.begin();
    inputManager.setCandidateProvider((t) => ss.candidates(t));
    diagSessionStart(ss, 'RHYTHM', diagSessionOpts(ss.windows));
    setPlaySession(ss);
    return true;
  }, [acc, resetRun, clearCoachLine, showCoachMessage, waitAudioClock]);

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
    void waitAudioClock('resume').then((ok) => {
      // 기다리는 사이 나갔거나 다시 시작했거나 준비 조건이 깨졌으면 재개하지 않는다
      if (!ok || clockRef.current !== clock || clock.state.phase !== 'paused' || !readyRef.current) return;
      clock.resume();
      diagSessionPhase('resume');
      setPauseReason(null);
    });
  }, [waitAudioClock]);

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
    void waitAudioClock('restart').then((ok) => {
      // 기다리는 사이 나갔거나 곡이 바뀌었으면 다시 시작하지 않는다
      if (!ok || clockRef.current !== clock || sessionRef.current !== ss) return;
      clock.restart();
      diagSessionStart(ss, 'RHYTHM', diagSessionOpts(ss.windows));
      resetRun(ss);
      coachRef.current?.reset();
      llmRef.current?.cancel(crypto.randomUUID());
      shadowRef.current?.reset();
      clearCoachLine();
    });
  }, [resetRun, clearCoachLine, waitAudioClock]);

  /** 나가기: 기록 없이 곡 선택으로(곡·단계를 골라 둔 채) */
  const leave = useCallback(() => {
    diagSessionEnd('left');
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    sessionRef.current?.reset();
    coachRef.current = null;
    shadowRef.current = null;
    clearCoachLine();
    resetCountdown();
    setPauseReason(null);
    flashes.current.clear();
    popups.current = [];
    setHud(null);
    setPlaySession(null);
    navigate(returnTo, { replace: true });
  }, [navigate, returnTo, resetCountdown, clearCoachLine]);

  /** 시작 대기 취소: 팝업을 닫는다(주소의 곡·단계 선택은 남긴다) */
  const closeStart = useCallback(() => setStartTarget(null), []);

  /** 카운트다운으로 들어가고 시작 대기를 끈다. begin 안의 await 사이에 다시 불리지 않게 막는다 */
  const beginning = useRef(false);
  const startPlay = useCallback(async () => {
    if (beginning.current) return;
    // 센서 입력이고 박자 맞추기 기록이 없는 첫 연주는 시작 대신 대화상자를 연다(닫은 뒤 다시 시작하면 바로 시작)
    if (stageRef.current === 'ready' && readyRef.current && timingGate()) return;
    beginning.current = true;
    try {
      if (await begin()) setStartTarget(null);
    } finally {
      beginning.current = false;
    }
  }, [begin, timingGate]);

  const finish = useCallback(
    (ss: RhythmSession) => {
      if (finishing.current) return;
      finishing.current = true;
      diagSessionEnd('finished');
      clockRef.current?.stop();
      metronome.unlock();
      inputManager.setCandidateProvider(null);
      const songStartedAt = startedAt.current ?? new Date();
      const log = buildPlayLog({
        snapshot: ss.snapshot(),
        notes: ss.notes,
        hits: recorder.current.hits,
        missSeqs: recorder.current.missSeqs,
        audioOffsetMs: ss.audioOffsetMs,
        kickOffsetMs: ss.kickOffsetMs,
        countInMs: ss.preRollMs,
        chart: ss.chart,
        inputSource,
        timing: ss.windows,
        startedAt: songStartedAt,
        chartVersionId: ss.chart.chartVersionId ?? null,
        songNumericId: ss.chart.songNumericId ?? null,
        chartId: ss.chart.chartId ?? null,
        presetId: useSettings.getState().activePresetId,
        consent: consentAtStart.current,
        liveCoachEvents: coachRef.current ? [...coachRef.current.events()] : undefined,
      });
      // 끝난 뒤 도착한 LLM 구간 문구는 띄우지도 기록하지도 않는다
      llmRef.current?.cancel();
      savePlayLog(log);
      // 서버 업로드는 결과 화면을 막지 않는다(설계 COACH-002 D1)
      void startPlaySync(log.playId);
      navigate(`/result/${log.playId}`, { state: { prevBest: prevBest.current } });
    },
    [navigate, inputSource],
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

  // Space: 연주 중 일시정지(킥을 페달로 치는 입력일 때만 — 그 밖에서는 Space가 키보드 킥이다)
  useSpacePause({
    inSong: () => stageRef.current === 'play' && !gateOpenRef.current,
    canPause: () => pauseRef.current === null && !isResuming(),
    pause: () => pauseTo('user'),
  });

  // Esc: 연주 중 일시정지. 팝업의 Enter·Esc는 창이 맡는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // D1: 처리하지 않는 경우·포커스 요소가 소유한 키는 가로채지 않는다
      if (e.isComposing || e.defaultPrevented) return;
      if (gateOpenRef.current) return;
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      if (isKeyOwnedByTarget(e.target as KeyTarget, e.code)) return;
      if (stageRef.current !== 'play') return;
      // 일시정지 중에는 다이얼로그가 키를 소유한다(D6)
      // 복귀 카운트다운 중에는 Esc를 무시한다(일시정지 상태가 아니라 카운트다운이 끝나야 이어진다)
      if (pauseRef.current !== null || isResuming() || e.code !== 'Escape') return;
      pauseTo('user');
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pauseTo, isResuming]);

  // 시작 대기 중에만 서버 최고 기록을 읽는다. 내장 개발 소스는 로컬 기록을 쓰므로 조회하지 않는다(status idle)
  const records = useBestRecords(startOpen && songIdParam !== null ? [songIdParam] : [], 'RHYTHM', startOpen, songsSource);
  // 시작 대기 중 세션이 준비된 동안만 서버 최고 점수를 담아 둔다(연주 중에는 조회가 꺼져 비므로 시작 때 고정한 값을 쓴다, U4)
  const serverBestScore = songIdParam === null ? undefined : records.scoresBySong.get(songIdParam);
  useEffect(() => {
    if (stage === 'ready') serverPrevBest.current = { score: serverBestScore ?? null, accuracy: null };
  }, [stage, serverBestScore]);

  // 260번: 숨긴 연습 단계(노트가 NORMAL과 같아 곡 응답에서 빠진 채보)의 id가 URL에 남아 있으면(예전 링크·새로고침)
  // 기본 단계로 바꾼다. 사용자가 고른 것이 아니므로 방문 기록을 쌓지 않는다. 연주 중에는 바꾸지 않는다
  const selectParam = param.select;
  const fallbackChart =
    songIdParam !== null && chartIdParam !== null && detail !== null && detail.id === songIdParam ? chartFallback(detail, chartIdParam) : null;
  useEffect(() => {
    if (stage !== 'ready' || songIdParam === null || fallbackChart === null) return;
    selectParam(songIdParam, fallbackChart, { replace: true });
    // 시작 대기 대상도 바꾼 단계를 따라간다
    setStartTarget((t) => (t === null ? t : { song: songIdParam, chart: fallbackChart }));
  }, [stage, songIdParam, fallbackChart, selectParam]);

  const loadError = paramStatus === 'error' ? (param.error ?? '채보를 불러오지 못했습니다.') : accError;
  // 팝업을 띄워야 하는 경우: 기기 준비 안 됨(E3) · 불러오기 실패(E5) · 스네어 재정렬(E8) · 기기 시각 차이 경고(PLAY-006, 시작은 막지 않는다)
  const popupWanted = startOpen && (!ready || loadError !== null || realign.pending || clockSkew !== null);
  // 렌더 중 상태 맞춤(React 허용 패턴): 시작 대기가 끝나면 비우고, 팝업이 필요해지는 순간 기억한다
  if (!startOpen && popupSeen) setPopupSeen(false);
  else if (popupWanted && !popupSeen) setPopupSeen(true);
  const popupOpen = startOpen && (popupWanted || popupSeen);
  useLayoutEffect(() => {
    popupOpenRef.current = popupOpen;
  }, [popupOpen]);

  // 자동 시작: 팝업 없이 진행 중이던 경우에만. 신기록 판정을 위해 서버 최고 기록 조회가 끝난 뒤(ready·error·idle)에 한다
  const autoStart =
    startOpen && stage === 'ready' && ready && !popupSeen && !realign.pending && clockSkew === null && records.status !== 'loading' && fallbackChart === null && loadError === null;
  useEffect(() => {
    if (autoStart) void startPlay();
  }, [autoStart, startPlay]);

  const sameSong = detail !== null && (songIdParam === null || detail.id === songIdParam);

  // 곡 선택(+필요할 때만 뜨는 팝업). 연주 단계가 아니면 항상 곡 선택이 바닥에 있다
  if (stage !== 'play' || !chart || !activeSession) {
    const chartDifficulty = chart?.difficulty ?? detail?.charts.find((c) => c.id === chartIdParam)?.difficulty ?? 'NORMAL';
    return (
      <>
        <AudioWaitNotice show={audioWaiting} />
        <StageFade stageKey="select">
          <main className="main">
            <SongPicker
              mode="play"
              starting={startTarget !== null}
              onStart={(song, chartId) => {
                // 클릭 안에서 오디오 잠금을 미리 풀어 둔다(자동 시작은 클릭 뒤 비동기로 일어난다)
                void unlockAudio();
                param.select(song, chartId);
                setStartTarget({ song, chart: chartId });
              }}
            />
          </main>
        </StageFade>
        <StartDialog
          open={popupOpen && !timingOpen}
          variant={ready ? 'play' : 'setup'}
          song={{
            title: chart?.title ?? (sameSong ? detail.title : '곡 정보를 불러오는 중'),
            artist: sameSong ? detail.artist : '',
            bpm: chart?.bpm ?? (sameSong ? detail.bpm : undefined),
            durationSec: chart ? chart.durationMs / 1000 : undefined,
            level: chartDifficulty,
          }}
          modeLabel="리듬 게임"
          missing={missing}
          connected={connected}
          keyboardOnly={settings.sensorKind === 'none'}
          pedal={pedalRequired(settings.sensorKind) ? pedalConnected({ connected: pedalPair }) : undefined}
          countInBars={settings.countInBars}
          goodMsNote={widened ? windows.goodMs : null}
          realign={realign.info}
          notices={clockSkew ? [clockSkewText(clockSkew)] : []}
          loading={loadError === null && stage !== 'ready'}
          error={loadError}
          onStart={() => void startPlay()}
          onSetup={() =>
            navigate('/setup', { state: { returnTo, returnLabel: `리듬 게임 · ${chart?.title ?? detail?.title ?? '곡'}` } })
          }
          onReconnect={reconnectAvailable ? () => void reconnect() : undefined}
          onRetry={param.reload}
          onClose={closeStart}
        />
        {timingDialog}
      </>
    );
  }

  const song = {
    title: chart.title,
    artist: sameSong ? detail.artist : '',
    coverUrl: sameSong ? detail.coverUrl : null,
    bpm: chart.bpm,
    durationSec: chart.durationMs / 1000,
  };


  // 연주 중. 정확도는 지금까지 판정한 노트 기준(곡 전체 기준 정확도는 결과 화면)
  const snap = hud ?? activeSession.snapshot();
  const perfectScore = activeSession.notes.length ? snap.maxScore / activeSession.notes.length : 0;
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
        hasAccompaniment={accUrl !== null}
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
        link={<LaneLinkLayer flashes={flashes} kitScale={kitScale} guide={guideLevels} />}
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
            session={activeSession}
            scrollMs={settings.scrollMs}
            flashes={flashes}
            popups={popups}
            keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
            onFrame={onFrame}
            fxSource={laneFx.source}
            topInset={GAME_HUD_INSET}
            topOverlay={<ComboDisplay combo={snap.combo} judgement={snap.last?.judgement ?? null} at={snap.last?.at ?? null} />}
            overlay={
              settings.timingBar ? (
                <TimingBar source={laneFx.source} perfectMs={activeSession.windows.perfectMs} goodMs={activeSession.windows.goodMs} resetToken={fxRun} missSource={missSource} />
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
            <LiveDrumKit
              scale={kitScale}
              view="persp"
              effects
              states={padStates}
              labels={false}
              skin="neon"
              badges={settings.gameGuide ? guideBadges : undefined}
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
          <LazyChartAutoplayRunner clockRef={clockRef} session={playSession} />
        </Suspense>
      )}
      <AudioWaitNotice show={audioWaiting} />
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
