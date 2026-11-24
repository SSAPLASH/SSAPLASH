// 악보 연주 (MODE-003 설계 4-1~4-4, 설계 MODE-001-MODE-003-picker-quick-start). 곡 선택(+연습 단계) → 시작 확인 창(채보·반주 불러오기) → 카운트인 → 연주 → 결과 페이지.
// PlayPage와 같은 골격(PlayClock·반주·메트로놈 잠금)이다. 준비 화면은 없다 — 곡 선택 위에 시작 확인 창(StartDialog)이 열린다:
// 곡 선택 SongPicker · 시작 확인 StartDialog(+PlayOptions) · 연주 PlayStage(PlayHud sheet·SheetPager·DrumKit 다음 박 배지). 연주 중은 셸을 숨긴 전체 화면이다.
// 주소: `?song=&chart=`는 곡 선택에서 곡·단계를 골라 두고, `&start=1`이 더해지면 시작 확인 창이 열린다.
// `&auto=1`(학습 코스 레슨을 통과해 자동으로 넘어온 주소)이면 조건이 맞을 때 플레이를 누르지 않아도 시작한다(설계 SETUP-학습-코스-자동-넘김).
// 점수·콤보는 보이지 않고 노트 색과 판정 수만 보인다. 일시정지는 Esc·스틱 끊김·메뉴 요청 3종(PauseOverlay).
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/kit/keyTarget';
import { SongPicker } from '@/features/play/components/picker/SongPicker';
import { useChartParam } from '@/features/play/components/picker/useChartParam';
import { SheetPager } from '@/features/play/components/stage/sheet/SheetPager';
import { usePauseTriggers } from '@/features/play/components/pause/usePauseTriggers';
import { useSpacePause } from '@/features/play/components/pause/useSpacePause';
import { useReconnectResume } from '@/features/play/components/pause/useReconnectResume';
import { useJudgementHaptic } from '@/features/play/components/stage/useJudgementHaptic';
import { PauseOverlay, type PauseReason } from '@/features/play/components/pause/PauseOverlay';
import { StageFade } from '@/features/play/components/stage/StageFade';
import { PlayStage } from '@/features/play/components/stage/PlayStage';
import { kitSoundStage, type PlayStageName } from '@/features/play/components/stage/kit/kitSoundStage';
import { LazyChartAutoplayRunner } from '@/features/play/components/diag/lazyChartAutoplay';
import { PlayHud } from '@/features/play/components/stage/PlayHud';
import { AudioWaitNotice } from '@/features/play/components/stage/AudioWaitNotice';
import { Countdown } from '@/components/ui/feedback/Countdown';
import { useAudioClockGate } from '@/features/play/components/stage/useAudioClockGate';
import { countdownValue } from '@/domain/time/leadIn';
import { resolveSubdivision, type SubdivisionPref } from '@/domain/time/metronome';
import { rateLabel, scaleChart } from '@/domain/song/practiceRate';
import { practiceRateKey, rateFor, usePracticeRate } from '@/features/play/store/practiceRate';
import { metronomePreview } from '@/runtime/metronomePreview';
import { ScreenGate } from '@/features/play/components/stage/ScreenGate';
import { useScreenFits } from '@/features/play/components/stage/screenFit';
import { GuideSlot } from '@/features/play/components/stage/GuideSlot';
import { useCoachLine } from '@/features/play/components/stage/coach/useCoachLine';
import { planCoachDisplay } from '@/features/play/components/stage/coach/coachDisplay';
import { CoachHandChip } from '@/features/play/components/stage/coach/CoachHandChip';
import { HitReadout } from '@/features/play/components/stage/HitReadout';
import { StartDialog } from '@/features/play/components/start/StartDialog';
import { pedalConnected, pedalRequired } from '@/domain/kit/device/pedalStatus';
import { kitSizeAt, smallKitSpec } from '@/domain/kit/drumKit';
import { useSheetKitFit } from '@/features/play/components/stage/kit/useSheetKitFit';
import { PlayOptions } from '@/features/play/components/start/PlayOptions';
import { useNextBeatLabels } from '@/features/play/components/stage/useNextBeatLabels';
import { LiveDrumKit } from '@/components/drum/LiveDrumKit';
import { createFxEmitter, judgedFxEvent, missFxEvent } from '@/components/fx/fxSource';
import { TimingBar } from '@/features/play/components/stage/TimingBar';
import { strayMissSource } from '@/features/play/components/stage/strayMissSource';
import type { HitMark } from '@/components/sheetmusic/sheetStripDraw';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { useDock, usePlayRunning, useShell } from '@/components/shell/nav/useShell';
import { useReadiness } from '@/features/play/components/start/useReadiness';
import { useRealign } from '@/components/calibration/useRealign';
import type { Chart } from '@/domain/song/chart';
import { artistLabel, chartFallback, type SongDetail } from '@/domain/song/songCatalog';
import { EMPTY_PREV_BEST, localPrevBest, prevBestFor, type PrevBest } from '@/domain/play/bestRecord';
import { useBestRecords } from './useBestRecords';
import { appliedWindows, type Judgement } from '@/domain/play/judgement';
import { isSensorSource, type InputSourceKind } from '@/domain/events';
import '@/components/lesson/lesson.css';
import { isBeginnerChart, lessonOfChart, trimLessonTail } from '@/domain/play/lesson';
import { ACCOMPANIMENT_OVERRIDE } from '@/config/accompaniment';
import { GO_MS, NO_LESSONS, parseId } from '@/features/play/domain/playShared';
import { useLessons } from '@/store/lessonStore';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import { buildPlayLog, loadPlayLogs, savePlayLog } from '@/engine/playLog';
import { PlayRecorder } from './playRecorder';
import { HihatPedalCoverageTracker, shouldWarnOpenHihat } from '@/domain/kit/device/hihatPedalCoverage';
import { readCurrentConsent } from './dataConsent';
import { startPlaySync } from '@/runtime/playSync';
import { disarm, finishSong, setLocked } from '@/runtime/recordingStore';
import { diagSessionEnd, diagSessionPhase, diagSessionStart, reportHit } from '@/engine/diagReport';
import { kickOffsetOrStick } from '@/domain/kit/calibration/timingCalibration';
import { diagSessionOpts } from './diagSessionOpts';
import { useTimingCalGate } from './useTimingCalGate';
import { PlayClock } from './sessionClock';
import { metronome } from '@/engine/Metronome';
import { inputManager } from '@/runtime/sources';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { unlockAudio } from '@/runtime/audioUnlock';
import { audioEngine } from '@/audio/AudioEngine';
import { Accompaniment } from '@/audio/Accompaniment';
import { useSongs, type LoadedChart } from '@/store/songStore';
import { useLive } from '@/store/liveStore';
import { clockSkewText } from '@/domain/kit/device/arrivalSkew';
import { liveAimSource } from './liveAim';
import { useReconnect } from '@/store/reconnectStore';
import { useSettings } from '@/store/settingsStore';
import { chartCoachContext, chooseCoachModel, coachCopy, isStickSensor, LiveCoach, LlmCoach, refreshCoachModels, type CoachCopy, type CoachMessage } from '@/coach/live';
import { liveCoachClient } from '@/features/play/api/liveCoach';
import { useAuth } from '@/store/authStore';
import type { CoachShadow } from '@/features/play/coach/shadowCoach';
import { COACH_BASIS } from '@/domain/play/coachBasis';
import { diagTap } from '@/engine/diagTap';

// 단계는 URL 파라미터 상태·세션에서 렌더 중 파생한다. paused는 pauseReason으로 표시
type Stage = PlayStageName;

/** 진단 빌드(VITE_MONITOR)에서만 코칭 그림자 평가를 켠다. 상수 분기라 미설정 빌드에는 코드가 남지 않는다 */
const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';

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
  // 사이드바 실제 접힘(사용자 설정 또는 태블릿 폭). 펼쳐져 있으면 곡 범위를 사이드바 하위 메뉴가 보인다
  // 작은 킷: 실물 스킨은 위에서 본 그림, 전자·네온은 기존 크기
  // 킷은 악보 칸을 뺀 남는 높이에 맞춰 키운다(설계 MODE-003-practice-speed D18)
  const kitFit = useSheetKitFit();
  const smallKit = smallKitSpec('sheet', settings.kitSkin, kitFit);
  const kitBox = kitSizeAt(smallKit.scale, settings.kitSkin, smallKit.view);
  const [searchParams, setSearchParams] = useSearchParams();
  // 연주 중인 세션. 연주 중 설정이 바뀌어도 세션을 새로 만들지 않도록 begin 때 고정한다
  const [playSession, setPlaySession] = useState<RhythmSession | null>(null);
  // 시작 확인 창이 열려 있는가: `?start=1`이고 곡·단계가 주소에 있을 때. 채보·반주는 이때부터(연주 중에도) 읽는다
  const startParam = searchParams.get('start') === '1';
  // 레슨을 통과해 자동으로 넘어온 주소. 한 번 쓰면 주소에서 지운다
  const autoParam = searchParams.get('auto') === '1';
  const param = useChartParam({ enabled: startParam || playSession !== null });
  const { status: paramStatus, loaded: paramLoaded } = param;
  const songIdParam = parseId(searchParams.get('song'));
  const chartIdParam = parseId(searchParams.get('chart'));
  const [acc] = useState(() => new Accompaniment(audioEngine));
  const [accResult, setAccResult] = useState<AccResult | null>(null);
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
  // 진단 빌드에서만 채워지는 그림자 코치(두 기준 방식 비교, MODE-001 D6)
  const shadowRef = useRef<CoachShadow | null>(null);
  // 연주 중 LLM 구간 코칭 요청기. 다시 하기·종료·화면 이탈 때 기다리던 결과를 버린다
  const llmRef = useRef<LlmCoach | null>(null);
  useEffect(() => () => llmRef.current?.cancel(), []);
  const { line: coachLine, show: showCoachLine, cancelPending: cancelPendingCoach, clear: clearCoachLine } = useCoachLine<CoachCopy>();
  // 악보 연습은 미루지 않지만, 일시정지하면 대기 중인 문구가 있다면 버린다(떠 있는 문구는 그대로)
  useEffect(() => {
    if (pauseReason !== null) cancelPendingCoach();
  }, [pauseReason, cancelPendingCoach]);

  // 준비 조건 미충족이면 시작·재개하지 못한다(키보드 전용은 면제)
  const { ready, missing } = useReadiness();
  const connected = useLive((l) => l.connected);
  const clockSkew = useLive((l) => l.clockSkew);
  const pedalPair = useLive((l) => l.pedal.connected);
  const lastHit = useLive((l) => l.lastHit);
  const reconnectAvailable = useReconnect((r) => r.available);
  const reconnect = useReconnect((r) => r.reconnect);
  const selectSong = useSongs((s) => s.selectSong);
  const songsSource = useSongs((s) => s.source);
  const readyRef = useRef(ready);
  // begin()이 읽는 ref는 화면을 그리기 전에 맞춘다(useEffect면 ▶ 플레이가 보인 직후 누른 클릭이 옛 값을 보고 무시될 수 있다)
  useLayoutEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // 반주 URL: 개발 override > 자산. 없으면 반주 없이 클릭만
  // 설정 `accompaniment`가 꺼져 있으면 반주를 불러오지도 재생하지도 않는다(MODE-003)
  const accEnabled = settings.accompaniment;
  const accAvailableUrl = paramLoaded ? (ACCOMPANIMENT_OVERRIDE ?? paramLoaded.assets?.accompanimentUrl ?? null) : null;
  const accUrl = accEnabled ? accAvailableUrl : null;
  const accCurrent = accResult && accResult.loaded === paramLoaded ? accResult : null;
  const accError = accUrl !== null && accCurrent && !accCurrent.ok ? (accCurrent.error ?? '반주를 불러오지 못했습니다.') : null;
  const sourceChart: Chart | null = paramLoaded && (accUrl === null || accCurrent?.ok) ? paramLoaded.chart : null;
  // 연습 속도(설계 MODE-003-practice-speed): 반주가 울리지 않을 때만 쓴다. 고른 값은 채보별로 기억하고(저장하지 않는다) 다른 채보에서는 100 %다.
  // 배율이 1이 아니면 채보를 늘려서 세션을 만든다 — 엔진·곡 시계·악보·메트로놈은 늘린 채보를 그대로 본다
  // 학습 코스의 연주 레슨에서는 속도를 고르지 않는다(설계 MODE-003-practice-speed D17) — 통과는 원래 빠르기 기록만 세므로(BE) 느리게 완주해도 레슨이 열리지 않는다
  const lessons = useLessons((l) => l.list)?.items ?? NO_LESSONS;
  const lessonPlay = lessonOfChart(lessons, chartIdParam)?.kind === 'PLAY';
  const rateKey = practiceRateKey(songIdParam, chartIdParam);
  const pickedRate = usePracticeRate((r) => rateFor(r, rateKey));
  const setPracticeRate = usePracticeRate((r) => r.setRate);
  const rate = accUrl === null && !lessonPlay ? pickedRate : 1;
  // 연주 레슨은 마지막 노트 뒤 빈 구간을 줄인다(385 후속) — 세션·악보·진행 표시·기록이 줄인 길이를 그대로 본다
  const readyChart: Chart | null = useMemo(() => {
    if (!sourceChart) return null;
    const scaled = scaleChart(sourceChart, rate);
    return lessonPlay ? trimLessonTail(scaled) : scaled;
  }, [sourceChart, rate, lessonPlay]);

  // 판정 폭: 쉬운 채보·입문 코스 연주 레슨이면 GOOD을 넓힌다(PLAY-004 3-5). 세션·타이밍 막대·진단 줄·플레이 로그가 이 값 하나를 쓴다
  const beginner = readyChart ? isBeginnerChart({ difficulty: readyChart.difficulty, chartId: readyChart.chartId, lessons }) : false;
  const windows = useMemo(() => appliedWindows(settings.timing, beginner), [settings.timing, beginner]);
  const widened = beginner && windows.goodMs > settings.timing.goodMs;

  // 준비 단계 세션. 설정이 바뀌면 준비 화면에서만 새로 만든다
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
  const startOpen = startParam && songIdParam !== null && chartIdParam !== null;
  const stage: Stage = playSession ? 'play' : !startOpen ? 'select' : session ? 'ready' : 'loading';
  // 스네어 재정렬(PLAY-004 D11·D12): 시작 확인 창과 끊김 복귀 카드에서만 세션을 연다
  const realign = useRealign(stage === 'ready' || pauseReason === 'reconnected');
  // 키보드 드럼은 연주 단계에서만 받는다(곡 선택·시작 확인 창에서는 키를 가로채지 않는다)
  useKeyboardDrum(stage === 'play');
  // Dock도 연주 단계(카운트인·일시정지 포함)에서만 둔다. 곡 선택·시작 확인 창에는 없다(QA 352 Q8)
  useDock(stage === 'play');

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

  const recorder = useRef(new PlayRecorder());
  const pedalCoverage = useRef<HihatPedalCoverageTracker | null>(null);
  const openWarnings = useRef(new Map<number, number>());
  // 친 위치 눈금(PERFECT·GOOD). SheetPager가 매 프레임 읽는다(React state를 거치지 않는다)
  const hitMarks = useRef<HitMark[]>([]);
  // 이펙트 소스: 패드(DrumKit)와 악보·타이밍 막대에 판정 이벤트를 따로 보낸다. MISS는 악보 쪽으로만
  const [padFx] = useState(createFxEmitter);
  const [sheetFx] = useState(createFxEmitter);
  // 타이밍 막대 눈금을 비우는 신호(새 판·다시 시작)
  const [fxRun, setFxRun] = useState(0);

  useEffect(() => inputManager.onPedalStatus((foot, connected) => {
    if (foot === 2) pedalCoverage.current?.connection(connected);
  }), []);
  // 결과 화면 최고 기록 비교용(설계 D4): 서버 스냅샷(준비 화면에서만 채움)과 연주 시작 시점에 고정한 치기 전 최고 정확도
  const serverPrevBest = useRef<PrevBest>(EMPTY_PREV_BEST);
  const prevBest = useRef<PrevBest>(EMPTY_PREV_BEST);
  const startedAt = useRef<Date | null>(null);
  const consentAtStart = useRef(false);
  const lastHud = useRef(0);
  const finishing = useRef(false);
  // 카운트 숫자를 한 번이라도 보였는지(격자 0이 되는 순간 「시작!」을 보이려고) · 「시작!」 숨김 타이머
  const wasCounting = useRef(false);
  const goTimer = useRef<number | null>(null);

  const returnTo = location.pathname + location.search;
  const inputSource: InputSourceKind = settings.sensorKind === 'none' ? 'keyboard' : settings.sensorKind;
  // 첫 연주 전 박자 맞추기 권유(PLAY-004 4-3). 닫으면 시작 확인 창이 그대로 남아 다시 [플레이]를 누르면 시작한다
  const { gate: timingGate, dialog: timingDialog, open: timingOpen } = useTimingCalGate({ isSensor: () => isSensorSource(inputSource) });
  // 일시정지에서 드럼 세팅으로 갔다 돌아오면 시작 확인 창이 다시 열리게 start=1을 싣는다(연주 중 주소에는 start가 없다)
  const pauseReturnTo = useMemo(() => {
    const p = new URLSearchParams(location.search);
    p.set('start', '1');
    return `${location.pathname}?${p.toString()}`;
  }, [location.pathname, location.search]);

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
    const warnings = openWarnings.current;
    return () => {
      diagSessionEnd('left');
      pedalCoverage.current = null;
      warnings.clear();
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
    // 놓침 원인 계산용 노트 맥락(직전 패드·간격). 세션마다 한 번 계산한다
    const coachContext = chartCoachContext(activeSession.chart.notes);
    const offStray = activeSession.onStray((s) => coachRef.current?.pushStray(s.pad, s.songTimeMs, s.stickId, s.pose));
    const offJudgement = activeSession.onJudgement((e) => {
      recorder.current.judgement(e);
      // 놓친 노트 머리 파편(악보만). PERFECT·GOOD 이펙트는 onHit 경로에서 낸다
      const miss = missFxEvent(e, 'sheet');
      if (miss) sheetFx.emit(miss);
      setNoteStates((prev) => {
        const next = prev.slice();
        next[e.noteIndex] = e.judgement;
        return next;
      });
      setHud(activeSession.snapshot());
      // 코칭은 기록·노트 색·HUD 뒤에 한다. 변환·표시가 실패해도 연주를 막지 않는다
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
      // 비동기 거름의 문구는 늦게 온다. 그사이 다른 판으로 바뀌었으면 띄우지 않는다
      const show = (message: CoachMessage) => {
        if (coachRef.current !== coach) return;
        try {
          const copy = coachCopy(message, { keyboard: useSettings.getState().sensorKind === 'none' });
          if (copy) {
            // 악보 연습은 설명형: 항상 보조까지, 미루지 않는다
            const plan = planCoachDisplay(message.tMs, [], 'SHEET');
            showCoachLine(plan.compact ? { ...copy, sub: '' } : copy, message.displayMs, plan.delayMs);
          }
        } catch {
          // 코칭 오류는 무시한다
        }
      };
      const message = coach.push(judged, activeSession.snapshot().strayHits, show);
      shadowRef.current?.push(judged);
      if (message) show(message);
    });
    return () => {
      offStray();
      offJudgement();
    };
  }, [activeSession, showCoachLine, sheetFx]);

  // 타격: 즉시 발음 → 판정 → 로그·텔레메트리. 일시정지 중에는 세션에 넣지 않는다. 타격 진동은 스틱이 직접 울린다(PLAY-006)
  // 소리는 드럼 킷이 보이는 단계(준비·연주)에서만 낸다(QA 352). 곡 선택 중에는 어떤 입력으로 쳐도 울리지 않는다
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.pad && kitSoundStage(stageRef.current)) {
        const tAudio = audioEngine.trigger(hit.pad, hit.velocity);
        if (tAudio !== null) hit.tAudio = tAudio;
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
        if (ev && (ev.judgement === 'PERFECT' || ev.judgement === 'GOOD') && ss.notes[ev.noteIndex].note.hihatOpen === true) {
          if (hit.hihatClosed == null) pedalCoverage.current?.unknownHit();
          if (shouldWarnOpenHihat(true, ev.judgement, hit.hihatClosed, inputManager.getHihatPedalState().connected)) {
            openWarnings.current.set(ev.noteIndex, performance.now() + 400);
          }
        }
        // 친 위치 눈금: 노트 시각 + 빠름/늦음 = 친 곡 시각(채보 밖 점과 같은 시간 축)
        if (ev && (ev.judgement === 'PERFECT' || ev.judgement === 'GOOD') && ev.deltaMs !== null) {
          hitMarks.current.push({ timeMs: ss.notes[ev.noteIndex].note.timeMs + ev.deltaMs, judgement: ev.judgement });
        }
        // 채보 밖 타격: 악보에 작은 점으로 남긴다. 판정과 같은 곡 시각(오디오 오프셋 반영)
        if (!ev && hit.pad && lh.tSongMs !== undefined) {
          const timeMs = lh.tSongMs;
          setStrays((prev) => [...prev, { timeMs }]);
        }
      }
      reportHit(hit, ev, active ? ss : null);
      // 이펙트(표시만): 판정·헛침·비판정 이벤트 하나를 패드와 악보에 보낸다. 판정·기록 뒤라 실패해도 연주를 막지 않는다
      const fx = judgedFxEvent(hit, ev, 'sheet', Boolean(active));
      if (fx) {
        padFx.emit(fx);
        sheetFx.emit(fx);
      }
    });
  }, [padFx, sheetFx]);

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
        hihatPedalCoverage: pedalCoverage.current?.value(),
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
      pedalCoverage.current = null;
      openWarnings.current.clear();
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
      navigate(`/result/${log.playId}`, { replace: true, state: { prevBest: prevBest.current } });
    },
    [navigate, inputSource],
  );
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const resetRun = useCallback((ss: RhythmSession) => {
    recorder.current.reset();
    const pedal = inputManager.getHihatPedalState();
    pedalCoverage.current = new HihatPedalCoverageTracker(pedal.connected, pedal.closed !== null);
    openWarnings.current.clear();
    finishing.current = false;
    {
      const c = ss.chart;
      const local = localPrevBest(loadPlayLogs(), { mode: 'SHEET', songNumericId: c.songNumericId ?? null, chartId: c.chartId ?? null, songId: c.songId, difficulty: c.difficulty, goodMs: ss.windows.goodMs });
      prevBest.current = prevBestFor(local, serverPrevBest.current, ss.windows.goodMs);
    }
    startedAt.current = new Date();
    consentAtStart.current = readCurrentConsent();
    setNoteStates(new Array<Judgement | null>(ss.notes.length).fill(null));
    setStrays([]);
    hitMarks.current.length = 0;
    setFxRun((n) => n + 1);
    setHud(ss.snapshot());
    setSongMs(0);
    resetCountdown();
    setPauseReason(null);
  }, [resetCountdown]);

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
    // 서버 실험 설정이 있으면 실험군의 모델을 쓴다. 로그인 사용자는 같은 실험군에 남는다
    const model = chooseCoachModel(useAuth.getState().user?.id ?? null);
    // 연주 중 LLM 구간 코칭(실험 설정 llm, 로그인 사용자만). 구간이 끝나면 BE에 요청하고 기한 안의 문구만 띄운다
    const llmMode = st.liveCoach ? model.llm : null;
    let llm: LlmCoach | null = null;
    const coach = new LiveCoach({
      goodMs: ss.windows.goodMs,
      enabled: st.liveCoach,
      setupHints: isStickSensor(st.sensorKind),
      noteGapMedianMs: chartCoachContext(ss.chart.notes).noteGapMedianMs,
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
          if (coachRef.current !== coach) return;
          const message = coach.offerLlmTip(tip, ss.songTime(performance.now()));
          if (!message) return;
          try {
            const copy = coachCopy(message, { keyboard: useSettings.getState().sensorKind === 'none' });
            // 악보 연습은 설명형: 항상 보조까지, 미루지 않는다
            if (copy) showCoachLine(copy, message.displayMs, planCoachDisplay(message.tMs, [], 'SHEET').delayMs);
          } catch {
            // 코칭 오류는 무시한다
          }
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
      clickOn: () => useSettings.getState().metronome,
      // 박 분할(자동·4분·8분)은 곡의 대표 BPM으로 푼다. 예약 때마다 읽혀 연주 중 Dock에서 바꿔도 반영된다
      subdivision: () => resolveSubdivision(useSettings.getState().metronomeSubdivision, ss.chart.bpm),
      onBeat: (beatInBar, atMs) => metronome.pulse(beatInBar, atMs),
      audioClock: () => audioEngine.clockReading(),
      // 반주·클릭을 오디오 시계에 바로 예약하고 곡 시각을 들리는 오디오 시각에서 계산한다(설계 MODE-001 연주 시계를 오디오 시계 하나로)
      audioReading: () => audioEngine.audioReading(),
      clickAt: (ctxSec, level) => audioEngine.clickAtContext(ctxSec, level),
      onFinish: () => finishRef.current(ss),
    });
    clockRef.current = clock;
    clock.begin();
    inputManager.setCandidateProvider((t) => ss.candidates(t));
    diagSessionStart(ss, 'SHEET', diagSessionOpts(ss.windows));
    setPlaySession(ss);
    return true;
  }, [acc, resetRun, clearCoachLine, showCoachLine, waitAudioClock]);

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

  const restart = useCallback(() => {
    const clock = clockRef.current;
    const ss = sessionRef.current;
    if (!clock || !ss) return;
    void waitAudioClock('restart').then((ok) => {
      // 기다리는 사이 나갔거나 곡이 바뀌었으면 다시 시작하지 않는다
      if (!ok || clockRef.current !== clock || sessionRef.current !== ss) return;
      // 재시작은 카운트인부터. 메트로놈 잠금은 유지한다
      clock.restart();
      diagSessionStart(ss, 'SHEET', diagSessionOpts(ss.windows));
      resetRun(ss);
      coachRef.current?.reset();
      llmRef.current?.cancel(crypto.randomUUID());
      shadowRef.current?.reset();
      clearCoachLine();
    });
  }, [resetRun, clearCoachLine, waitAudioClock]);

  /** 나가기: 기록 없이 곡 선택으로(곡·단계를 골라 둔 채, 창은 닫힘 — 연주 중 주소에는 start가 없다) */
  const leave = useCallback(() => {
    diagSessionEnd('left');
    pedalCoverage.current = null;
    openWarnings.current.clear();
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    sessionRef.current?.reset();
    coachRef.current = null;
    shadowRef.current = null;
    clearCoachLine();
    resetCountdown();
    setPauseReason(null);
    setNoteStates([]);
    setStrays([]);
    hitMarks.current.length = 0;
    setHud(null);
    setPlaySession(null);
    navigate(returnTo, { replace: true });
  }, [navigate, returnTo, resetCountdown, clearCoachLine]);

  /** 시작 확인 창 닫기: 주소에서 start(와 자동 시작 표시 auto)만 지운다(곡·단계 선택은 남긴다) */
  const closeStart = useCallback(() => {
    // 창이 닫히면(취소·플레이) 박 분할 예시 소리도 끊는다
    metronomePreview.stop();
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('start');
        p.delete('auto');
        return p;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  /** [플레이]: 카운트다운으로 들어가고, 연주 중 주소에서는 start를 지워 둔다(뒤로 가기·나가기가 창을 다시 열지 않게) */
  const startPlay = useCallback(async (): Promise<boolean> => {
    // 센서 입력이고 박자 맞추기 기록이 없는 첫 연주는 시작 대신 대화상자를 연다(닫은 뒤 다시 시작하면 바로 시작)
    if (stageRef.current === 'ready' && readyRef.current && timingGate()) return false;
    if (!(await begin())) return false;
    closeStart();
    return true;
  }, [begin, closeStart, timingGate]);

  // 자동 시작(설계 SETUP-학습-코스-자동-넘김 3-4): 레슨 채보이고 기기가 준비됐고 설정의 카운트다운이 켜져 있을 때만,
  // 채보·반주 준비가 끝나는 순간 [플레이]를 한 번 대신 누른다. 조건이 하나라도 어긋나면 auto만 지우고 창은 그대로 둔다
  // (나중에 조건이 맞아져도 저절로 시작하지 않는다). 박자 맞추기 권유 같은 [플레이]의 관문은 그대로 거친다
  const autoEligible =
    autoParam && startOpen && ready && settings.countInBars > 0 && paramStatus !== 'error' && accError === null && lessonOfChart(lessons, chartIdParam)?.kind === 'PLAY';
  const autoHandled = useRef(false);
  useEffect(() => {
    if (!autoParam) {
      autoHandled.current = false;
      return;
    }
    if (autoHandled.current) return;
    // 조건은 맞는데 아직 읽는 중이면 기다린다
    if (autoEligible && stage === 'loading') return;
    autoHandled.current = true;
    const dropAuto = () =>
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete('auto');
          return p;
        },
        { replace: true },
      );
    if (autoEligible && stage === 'ready') {
      // 시작하지 못했으면(박자 맞추기 권유·오디오 준비 실패 등) auto를 지워 시작 확인 창으로 돌아온다
      startPlay().then(
        (started) => {
          if (!started) dropAuto();
        },
        () => dropAuto(),
      );
      return;
    }
    dropAuto();
  }, [autoParam, autoEligible, stage, startPlay, setSearchParams]);

  // 서버 코칭 모델·실험 설정을 미리 받아 둔다. 못 받으면 빌드 기본값으로 동작한다
  useEffect(() => {
    void refreshCoachModels();
  }, []);

  // 연주 중(play)은 셸을 숨긴 전체 화면. 곡 선택은 TopBar 제목 "악보 연습"
  useShell({ title: '악보 연습', immersive: stage === 'play' });
  // 카운트인이 끝나 곡이 진행 중일 때만 Dock이 자동으로 접힌다(일시정지·종료 시 해제)
  usePlayRunning(stage === 'play' && pauseReason === null && hud?.status === 'playing');
  // 판정 진동(PLAY-006): 연주 단계 전체(stage 'play' = playSession이 있는 동안)에서 로컬 진동을 끄고 판정으로 울린다
  useJudgementHaptic(activeSession, stage === 'play');
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
  }, [stage, isResuming]);

  // Space: 연주 중 일시정지(킥을 페달로 치는 입력일 때만 — 그 밖에서는 Space가 키보드 킥이다)
  useSpacePause({
    inSong: () => stageRef.current === 'play' && !gateOpenRef.current,
    canPause: () => pauseRef.current === null && !isResuming(),
    pause: () => pauseTo('user'),
  });

  // Enter / Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // D1: 처리하지 않는 경우·포커스 요소가 소유한 키는 가로채지 않는다
      if (e.isComposing || e.defaultPrevented) return;
      if (gateOpenRef.current) return;
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      if (isKeyOwnedByTarget(e.target as KeyTarget, e.code)) return;
      const st = stageRef.current;
      // 시작 확인 창(ready)의 Enter·Esc는 창이 맡는다
      if (st === 'play') {
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
  }, [pauseTo, isResuming]);

  // 스트립이 매 프레임 읽는 곡 시각. 연주 전·후에는 null(정지)
  const getSongTime = useCallback(
    () => (stageRef.current === 'play' ? (clockRef.current?.songTime() ?? null) : null),
    [],
  );
  // 킷: 타격(hit)·판정 색, 패드 위 다음 박 배지(highlight는 넘기지 않는다 — 넘기면 next 패드까지 강조된다)
  const padStates = usePadStates(activeSession);
  const hitSeq = usePadHitSeq();
  const { badges } = useNextBeatLabels({ session: activeSession, getSongTime, enabled: settings.sheetPadCount });

  const selectedChartId = chartIdParam ?? chart?.chartId ?? 0;
  const records = useBestRecords(
    stage !== 'select' && songIdParam !== null ? [songIdParam] : [],
    'SHEET', stage === 'ready' && detail?.id === songIdParam, songsSource,
  );
  // 시작 확인 창이 열린 동안만 서버 최고 정확도를 담아 둔다(연주 중에는 조회가 꺼져 비므로 시작 때 고정한 값을 쓴다, U4)
  const serverBestAccuracy = records.accuraciesByChart.get(selectedChartId);
  useEffect(() => {
    if (stage === 'ready') serverPrevBest.current = { score: null, accuracy: serverBestAccuracy ?? null };
  }, [stage, serverBestAccuracy]);

  // 260번: 숨긴 연습 단계(노트가 NORMAL과 같아 곡 응답에서 빠진 채보)의 id가 URL에 남아 있으면(예전 링크·새로고침)
  // 기본 단계로 바꾼다. 사용자가 고른 것이 아니므로 방문 기록을 쌓지 않는다. 연주 중에는 바꾸지 않는다
  const selectParam = param.select;
  useEffect(() => {
    if (stage !== 'ready' || songIdParam === null || chartIdParam === null || detail === null || detail.id !== songIdParam) return;
    const fallback = chartFallback(detail, chartIdParam);
    if (fallback !== null) selectParam(songIdParam, fallback, { replace: true, start: true });
  }, [stage, songIdParam, chartIdParam, detail, selectParam]);

  // 자동 시작을 기다리는 동안(auto가 주소에 남아 있는 동안)에는 곡 선택·시작 확인 창 대신 준비 화면만 보인다 —
  // 결과 화면에서 넘어올 때 학습 코스 화면과 창이 잠깐 비쳤다 사라지지 않게(11/13 로컬 확인). 시작하지 못하면 auto가 지워져 창이 뜬다
  if (stage !== 'play' && autoEligible) {
    return (
      <StageFade stageKey="auto">
        <main className="main">
          <div className="lesson-read" role="status">
            <span className="spinner" aria-hidden="true" />
            <p className="lesson-read-prompt">다음 레슨을 준비하고 있어요</p>
          </div>
        </main>
        {timingDialog}
      </StageFade>
    );
  }
  // 곡 선택(+시작 확인 창). 연주 단계가 아니면 항상 곡 선택이 바닥에 있고, 창은 그 위에 뜬다
  if (stage !== 'play' || !chart || !activeSession) {
    const sameSong = detail !== null && (songIdParam === null || detail.id === songIdParam);
    const chartDifficulty = chart?.difficulty ?? detail?.charts.find((c) => c.id === chartIdParam)?.difficulty ?? 'NORMAL';
    const loadError = paramStatus === 'error' ? (param.error ?? '채보를 불러오지 못했습니다.') : accError ? `${accError} 반주를 끄면 바로 시작할 수 있어요.` : null;
    // 박 분할 풀이 문구와 예시 소리의 기준 BPM(채보를 아직 못 불러왔으면 곡 정보의 BPM)
    const startSongBpm = chart?.bpm ?? (sameSong ? detail.bpm : undefined);
    const pickSubdivision = (v: SubdivisionPref) => {
      settings.setMetronomeSubdivision(v);
      // 고른 값을 이 곡의 BPM으로 두 박 들려준다
      if (startSongBpm !== undefined) void metronomePreview.play('song', startSongBpm, resolveSubdivision(v, startSongBpm));
    };
    return (
      <>
        <AudioWaitNotice show={audioWaiting} />
        <StageFade stageKey="select">
          <main className="main">
            {/* 사이드바가 펼쳐져 있으면 「악보 연습」 하위 메뉴가 곡 범위를 보이므로 화면 위 탭은 두지 않는다(설계 MODE-003-악보-연습-하위-메뉴) */}
            <SongPicker mode="sheet" onStart={(song, chartId) => param.select(song, chartId, { start: true })} />
          </main>
        </StageFade>
        <StartDialog
          open={startOpen && !timingOpen}
          variant={ready ? 'play' : 'setup'}
          song={{
            title: chart?.title ?? (sameSong ? detail.title : '곡 정보를 불러오는 중'),
            artist: sameSong ? detail.artist : '',
            // 곡 요약은 원래 빠르기·길이로 보인다(연습 속도는 옵션 줄에 따로 보인다)
            bpm: chart?.sourceTiming?.bpm ?? chart?.bpm ?? (sameSong ? detail.bpm : undefined),
            durationSec: chart ? (chart.sourceTiming?.durationMs ?? chart.durationMs) / 1000 : undefined,
            level: chartDifficulty,
          }}
          modeLabel="악보 연습"
          missing={missing}
          connected={connected}
          keyboardOnly={settings.sensorKind === 'none'}
          pedal={pedalRequired(settings.sensorKind) ? pedalConnected({ connected: pedalPair }) : undefined}
          countInBars={settings.countInBars}
          goodMsNote={widened ? windows.goodMs : null}
          realign={realign.info}
          loading={loadError === null && stage !== 'ready'}
          error={loadError}
          notices={[...(chart?.variableTempo ? ['변박 곡은 현재 지원하지 않습니다(고정 템포로 표시)'] : []), ...(clockSkew ? [clockSkewText(clockSkew)] : [])]}
          options={
            <PlayOptions
              rows={['metronome', 'padCount', 'accompaniment', 'recording']}
              metronome={settings.metronome}
              onMetronome={settings.setMetronome}
              subdivision={settings.metronomeSubdivision}
              onSubdivision={pickSubdivision}
              songBpm={startSongBpm}
              sourceBpm={chart?.sourceTiming?.bpm ?? startSongBpm}
              rate={rate}
              onRate={
                lessonPlay
                  ? undefined
                  : (r) => {
                      if (rateKey !== null) setPracticeRate(rateKey, r);
                    }
              }
              padCount={settings.sheetPadCount}
              onPadCount={settings.setSheetPadCount}
              hasAccompaniment={accAvailableUrl !== null || (paramLoaded === null && sameSong && detail.accompanimentStatus === 'READY')}
              accompaniment={settings.accompaniment}
              onAccompaniment={(v) => {
                settings.setAccompaniment(v);
                // 반주를 켜면 연습 속도는 100 %로 돌아간다
                if (v && rateKey !== null) setPracticeRate(rateKey, 1);
              }}
              accompanimentStatus={sameSong ? detail.accompanimentStatus : null}
            />
          }
          onStart={() => void startPlay()}
          onSetup={() =>
            navigate('/setup', { state: { returnTo, returnLabel: `악보 연습 · ${chart?.title ?? detail?.title ?? '곡'}` } })
          }
          onReconnect={reconnectAvailable ? () => void reconnect() : undefined}
          onRetry={param.reload}
          onClose={closeStart}
        />
        {timingDialog}
      </>
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
        returnTo={pauseReturnTo}
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
        variant="sheet"
        kitSize={{ width: Math.ceil(kitBox.width), height: Math.round(kitBox.height) }}
        hud={
          <PlayHud
            variant="sheet"
            title={song.title}
            artist={artistLabel(song.artist)}
            coverUrl={song.coverUrl}
            level={chart.difficulty}
            bpm={chart.bpm}
            rateLabel={chart.playbackRate !== undefined ? rateLabel(chart.playbackRate) : undefined}
            elapsedMs={songMs}
            durationMs={chart.durationMs}
            perfect={snap.counts.PERFECT}
            good={snap.counts.GOOD}
            miss={snap.counts.MISS}
          />
        }
        area={
          <SheetPager
            countInMs={activeSession.countInMs}
            openWarnings={openWarnings}
            chart={chart}
            noteStates={noteStates}
            strayHits={strays}
            hitMarks={hitMarks}
            getSongTime={getSongTime}
            fxSource={sheetFx.source}
            overlay={
              settings.timingBar ? (
                <TimingBar source={sheetFx.source} perfectMs={activeSession.windows.perfectMs} goodMs={activeSession.windows.goodMs} resetToken={fxRun} missSource={missSource} thin labels />
              ) : undefined
            }
          />
        }
        guide={
          coachLine ? (
            <GuideSlot mode={coachLine.mode} title={coachLine.title} sub={coachLine.sub} size="lg" />
          ) : (
            <GuideSlot mode="guide" title="악보 연습" sub="세로선에 도달한 마디를 연주하세요." />
          )
        }
        kit={
          <div className="coach-kit">
            <LiveDrumKit
              scale={smallKit.scale}
              view={smallKit.view}
              effects
              states={padStates}
              labels={false}
              badges={badges}
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
          <LazyChartAutoplayRunner clockRef={clockRef} session={playSession} />
        </Suspense>
      )}
      <AudioWaitNotice show={audioWaiting} />
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
