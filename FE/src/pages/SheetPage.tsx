// 악보 연주 (MODE-003 설계 4-1~4-4). 곡 선택 → 불러오기(채보·반주) → 준비 → 카운트인 → 연주 → 결과 페이지.
// PlayPage와 같은 골격(PlayClock·반주·메트로놈 잠금)이고 뷰는 마디 고정 악보(SheetPager) + 드럼 가이드(KitGuideView)다.
// 점수·콤보는 보이지 않고 노트 색과 판정 수만 보인다. 일시정지는 Esc·스틱 끊김·메뉴 요청 3종(PauseOverlay).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/keyTarget';
import { SongPicker } from '@/components/SongPicker';
import { useChartParam } from '@/components/useChartParam';
import { SheetPager } from '@/components/SheetPager';
import { KitGuideView } from '@/components/KitGuideView';
import { useHitFx } from '@/components/useHitFx';
import { usePauseTriggers } from '@/components/usePauseTriggers';
import { PauseOverlay, type PauseReason } from '@/components/PauseOverlay';
import { formatDuration, formatSongTime } from '@/components/formatTime';
import { useReadiness } from '@/components/useReadiness';
import type { Chart } from '@/domain/chart';
import { barCountOf, gridOriginMs, gridTimeOf } from '@/domain/sheet';
import { LANE_PADS, PAD_META } from '@/domain/pads';
import type { Judgement } from '@/domain/judgement';
import type { PadId } from '@/domain/pads';
import type { HitFx, InputSourceKind } from '@/domain/events';
import { KEY_MAP } from '@/domain/keyMap';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import {
  buildPlayLog,
  formatAccuracy,
  latestSheetLog,
  loadPlayLogs,
  savePlayLog,
} from '@/engine/playLog';
import { PlayRecorder } from '@/engine/playRecorder';
import { startPlaySync } from '@/app/playSync';
import { diagSessionEnd, diagSessionPhase, diagSessionStart, reportHit } from '@/engine/diagReport';
import { PlayClock } from '@/engine/sessionClock';
import { metronome } from '@/engine/Metronome';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/app/sources';
import { setSoundOnHit, unlockAudio } from '@/app/bootstrap';
import { audioEngine } from '@/audio/AudioEngine';
import { Accompaniment } from '@/audio/Accompaniment';
import type { LoadedChart } from '@/store/songStore';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { useSettings } from '@/store/settingsStore';

// 단계는 URL 파라미터 상태·세션에서 렌더 중 파생한다. paused는 pauseReason으로 표시
type Stage = 'select' | 'loading' | 'ready' | 'play';

/** 개발용: 설정하면 모든 곡에 이 반주 URL을 쓴다(로컬 BE에 S3가 없을 때) */
const ACCOMPANIMENT_OVERRIDE: string | undefined = import.meta.env.VITE_ACCOMPANIMENT_OVERRIDE || undefined;

const DIFF_LABEL: Record<Chart['difficulty'], string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

/** HUD 갱신 간격(ms) */
const HUD_INTERVAL_MS = 250;

/** 반주 디코드 결과. loaded가 현재 URL 파라미터의 결과와 같을 때만 유효하다 */
interface AccResult {
  loaded: LoadedChart;
  ok: boolean;
  error?: string;
}

export function SheetPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const presetItems = usePresets((p) => p.items);
  const param = useChartParam();
  const { status: paramStatus, loaded: paramLoaded } = param;
  const [acc] = useState(() => new Accompaniment(audioEngine));
  const [accResult, setAccResult] = useState<AccResult | null>(null);
  // 연주 중인 세션. 연주 중 설정이 바뀌어도 세션을 새로 만들지 않도록 begin 때 고정한다
  const [playSession, setPlaySession] = useState<RhythmSession | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const [hud, setHud] = useState<SessionSnapshot | null>(null);
  // HUD 표시용: 곡 시각(ms)·최근 판정 Δ·일시정지한 시각
  const [songMs, setSongMs] = useState(0);
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const [pausedAtMs, setPausedAtMs] = useState(0);
  const [noteStates, setNoteStates] = useState<(Judgement | null)[]>([]);
  const [strays, setStrays] = useState<{ timeMs: number }[]>([]);
  const [syncInfo, setSyncInfo] = useState<{ begin: number | null; resume: number | null } | null>(null);
  const clockRef = useRef<PlayClock | null>(null);
  // 드럼 가이드 타격 이펙트 (useHitFx가 live 스토어 타격을 기록)
  const hits = useRef(new Map<PadId, HitFx>());
  useHitFx(hits);

  // 준비 조건 미충족이면 시작·재개하지 못한다(키보드 전용은 면제)
  const { ready, missing } = useReadiness();
  const referenceStale = useLive((l) => l.referenceStale);
  const connected = useLive((l) => l.connected);
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
  useEffect(() => {
    stageRef.current = stage;
    sessionRef.current = activeSession;
    pauseRef.current = pauseReason;
  }, [stage, activeSession, pauseReason]);

  const recorder = useRef(new PlayRecorder());
  const startedAt = useRef<Date | null>(null);
  const lastHud = useRef(0);
  const finishing = useRef(false);

  const returnTo = location.pathname + location.search;
  const clearParam = param.clear;
  const inputSource: InputSourceKind = settings.sensorKind === 'none' ? 'keyboard' : settings.sensorKind;

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
    };
  }, [acc]);

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
      setLastDelta(e.deltaMs);
      setHud(activeSession.snapshot());
    });
  }, [activeSession]);

  // 타격: 즉시 발음 → 햅틱 → 판정 → 로그·텔레메트리. 일시정지 중에는 세션에 넣지 않는다
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.pad) {
        const tAudio = audioEngine.trigger(hit.pad, hit.velocity);
        if (tAudio !== null) hit.tAudio = tAudio;
        inputManager.haptic(hit.stickId, hit.velocity * 2, 30);
      }
      const ss = sessionRef.current;
      const active =
        ss &&
        stageRef.current === 'play' &&
        pauseRef.current === null &&
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
    clock.pause(reason);
    diagSessionPhase('pause');
    setPausedAtMs(clock.songTime());
    // 같은 틱의 중복 트리거(끊김 + 메뉴)를 막기 위해 ref도 바로 갱신한다
    pauseRef.current = reason;
    setPauseReason(reason);
  }, []);

  // 연결 끊김·메뉴 요청 → 자동 일시정지 (공용 훅)
  usePauseTriggers(pauseTo);

  const finish = useCallback(
    (ss: RhythmSession) => {
      if (finishing.current) return;
      finishing.current = true;
      diagSessionEnd('finished');
      clockRef.current?.stop();
      metronome.unlock();
      inputManager.setCandidateProvider(null);
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
        startedAt: startedAt.current ?? new Date(),
        chartVersionId: ss.chart.chartVersionId ?? null,
        songNumericId: ss.chart.songNumericId ?? null,
        chartId: ss.chart.chartId ?? null,
        presetId: useSettings.getState().activePresetId,
      });
      savePlayLog(log);
      // 서버 업로드는 결과 화면을 막지 않는다(설계 COACH-002 D1)
      void startPlaySync(log.playId);
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
    setNoteStates(new Array<Judgement | null>(ss.notes.length).fill(null));
    setStrays([]);
    setHud(ss.snapshot());
    setSongMs(0);
    setLastDelta(null);
    setPauseReason(null);
  }, []);

  const begin = useCallback(async () => {
    const ss = sessionRef.current;
    if (!ss || stageRef.current !== 'ready' || !readyRef.current) return;
    await unlockAudio();
    resetRun(ss);
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
    setSyncInfo({ ...clock.sync });
    inputManager.setCandidateProvider((t) => ss.candidates(t));
    diagSessionStart(ss, 'SHEET', { windows: useSettings.getState().timing, audioOffsetMs: useSettings.getState().audioOffsetMs });
    setPlaySession(ss);
  }, [acc, resetRun]);

  const resume = useCallback(() => {
    const clock = clockRef.current;
    if (!clock || !readyRef.current || pauseRef.current === null) return;
    clock.resume();
    diagSessionPhase('resume');
    setSyncInfo({ ...clock.sync });
    setPauseReason(null);
  }, []);

  const restart = useCallback(() => {
    const clock = clockRef.current;
    const ss = sessionRef.current;
    if (!clock || !ss) return;
    // 재시작은 카운트인부터. 메트로놈 잠금은 유지한다
    clock.restart();
    diagSessionStart(ss, 'SHEET', { windows: useSettings.getState().timing, audioOffsetMs: useSettings.getState().audioOffsetMs });
    resetRun(ss);
    setSyncInfo({ ...clock.sync });
  }, [resetRun]);

  /** 나가기: 기록 없이 준비 화면으로(곡 선택 유지) */
  const leave = useCallback(() => {
    diagSessionEnd('left');
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    sessionRef.current?.reset();
    setPauseReason(null);
    setNoteStates([]);
    setStrays([]);
    setHud(null);
    setPlaySession(null);
    navigate(returnTo, { replace: true });
  }, [navigate, returnTo]);

  const toSelect = useCallback(() => {
    diagSessionEnd('left');
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    clearParam();
  }, [clearParam]);

  // 연주 중 프레임: 세션 tick·종료 감지는 PlayClock, HUD는 4Hz
  useEffect(() => {
    if (stage !== 'play') return;
    let raf = 0;
    const loop = (now: number) => {
      const clock = clockRef.current;
      const ss = sessionRef.current;
      if (clock && ss) {
        clock.onFrame(now);
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

  // 스트립이 매 프레임 읽는 곡 시각. 연주 전·후에는 null(정지)
  const getSongTime = useCallback(
    () => (stageRef.current === 'play' ? (clockRef.current?.songTime() ?? null) : null),
    [],
  );

  // 화면 표시용 파생값
  const sensorMode = settings.sensorKind !== 'none';
  const inputLabel = sensorMode ? inputSource : '키보드';
  // 프리셋 이름은 저장소(로컬/서버)와 무관하게 presetStore.items가 단일 진실이다. settings.presets[]는 익명 전용 로컬 목록
  const presetName = presetItems.find((p) => p.id === settings.activePresetId)?.name ?? null;
  const stickText = !sensorMode
    ? '키보드 전용'
    : connected[0] && connected[1]
      ? 'L · R'
      : connected[0]
        ? 'L'
        : connected[1]
          ? 'R'
          : '연결 안 됨';
  const usedPads = useMemo(() => {
    if (!chart) return [];
    const set = new Set(chart.notes.map((n) => n.pad));
    return LANE_PADS.filter((p) => set.has(p)).map((p) => PAD_META[p].label);
  }, [chart]);
  const lastLog = useMemo(
    () => (chart ? latestSheetLog(loadPlayLogs(), { songNumericId: chart.songNumericId, songId: chart.songId }) : null),
    [chart],
  );

  if (stage === 'loading') {
    return (
      <main className="main sheet-mode">
        <div className="sm-card" style={{ maxWidth: 480 }}>
          {accError ? (
            <>
              <div className="notice error" role="alert">
                {accError}
              </div>
              <div className="sm-toolbar">
                {paramLoaded && (
                  <button
                    className="sm-btn primary"
                    onClick={() => {
                      acc.unload();
                      setAccResult({ loaded: paramLoaded, ok: true });
                    }}
                  >
                    반주 없이 계속
                  </button>
                )}
                <button className="sm-btn" onClick={toSelect}>
                  곡 선택으로
                </button>
              </div>
            </>
          ) : paramStatus === 'error' ? (
            <>
              <div className="notice error" role="alert">
                {param.error ?? '채보를 불러오지 못했습니다.'}
              </div>
              <div className="sm-toolbar">
                <button className="sm-btn" onClick={toSelect}>
                  곡 선택으로
                </button>
              </div>
            </>
          ) : (
            <div className="sm-spinner-row">
              <span className="spinner" aria-label="불러오는 중" />
              <span className="sm-sub">{accLoading ? '반주 불러오는 중' : '채보를 불러오는 중'}</span>
            </div>
          )}
        </div>
      </main>
    );
  }

  if (stage === 'select' || !chart || !activeSession) {
    return (
      <main className="main sheet-mode">
        <div className="sm-head" style={{ justifyContent: 'space-between' }}>
          <div className="sm-head-title">
            <span className="sm-label">악보 연습</span>
            <h1 className="sm-h1-lg">무엇을 쳐 볼까요</h1>
          </div>
          <span style={{ color: 'var(--sm-text-3)' }}>곡을 고르고 난이도를 누르면 준비 화면으로 갑니다</span>
        </div>
        <section className="sm-grid select">
          <div className="sm-card" style={{ gap: 14 }}>
            <SongPicker mode="sheet" onSelect={param.select} />
          </div>
          <div className="sm-stack">
            <div className="sm-card">
              <span className="sm-label">악보 연습이란</span>
              <p>
                반주에 맞춰 마디가 화면에 고정되고 커서가 왼쪽에서 오른쪽으로 지나갑니다. 아래 드럼 킷에는 다음에 칠 박
                번호가 패드 위에 보입니다. 점수와 콤보는 없고, 칠 때마다 음표가 판정 색으로 바뀝니다.
              </p>
              <p>끝나면 결과 페이지에서 약한 패드와 마디 구간을 짚어 주고, 그 구간을 미니 악보로 보여 줍니다.</p>
            </div>
            <div className="sm-card" style={{ gap: 10 }}>
              <span className="sm-label">현재 설정</span>
              <dl className="sm-kv">
                <dt>입력</dt>
                <dd>{inputLabel}</dd>
                <dt>프리셋</dt>
                <dd>{presetName ?? '—'}</dd>
                <dt>판정 폭</dt>
                <dd style={{ fontVariantNumeric: 'tabular-nums' }}>
                  Perfect ±{settings.timing.perfectMs} ms · Good ±{settings.timing.goodMs} ms
                </dd>
                <dt>카운트인</dt>
                <dd>{settings.countInBars}마디</dd>
                <dt>메트로놈</dt>
                <dd>{settings.metronome ? '곡 중 클릭 켬' : '곡 중 클릭 끔'}</dd>
              </dl>
              <Link to="/setup" state={{ returnTo }} style={{ alignSelf: 'flex-start', fontSize: 12 }}>
                세팅에서 바꾸기
              </Link>
            </div>
            <span className="sm-hint">Enter 시작 · Esc 일시정지 · 결과는 이 브라우저에 최근 20건까지 남습니다</span>
          </div>
        </section>
      </main>
    );
  }

  const snap = hud ?? activeSession.snapshot();
  const hasAcc = acc.state === 'ready' || acc.state === 'playing' || acc.state === 'paused';
  const beatMs = 60_000 / chart.bpm;
  const barMs = beatMs * chart.beatsPerBar;
  const bars = barCountOf(chart);
  const originMs = gridOriginMs(chart);
  const diffTone = chart.difficulty === 'HARD' ? 'danger' : 'neutral';
  const metaChips = (
    <>
      <span className={`sm-chip ${diffTone}`}>{DIFF_LABEL[chart.difficulty]}</span>
      <span className="sm-chip neutral">
        {chart.bpm} BPM · {chart.beatsPerBar}/4
      </span>
      <span className="sm-chip neutral">
        {bars}마디 · {formatDuration(chart.durationMs)}
        {stage === 'ready' && ` · 노트 ${chart.notes.length}`}
      </span>
      <span className={`sm-chip ${hasAcc ? 'info' : 'neutral'}`}>{hasAcc ? '반주 있음' : '반주 없음'}</span>
      {stage === 'ready' && originMs >= beatMs && (
        // 인트로가 1박 이상인 곡: 커서가 바로 움직이지 않는 이유를 미리 알린다
        <span className="sm-chip neutral">첫 박 {(originMs / 1000).toFixed(1)}초</span>
      )}
    </>
  );
  const strip = (
    <SheetPager
      chart={chart}
      noteStates={noteStates}
      strayHits={strays}
      getSongTime={getSongTime}
      countInMs={activeSession.countInMs}
    />
  );

  if (stage === 'ready') {
    return (
      <main className="main sheet-mode">
        <div className="sm-toolbar" style={{ gap: 12 }}>
          <button className="sm-btn ghost" onClick={toSelect}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M12 4l-6 6 6 6" />
            </svg>
            곡 선택 <span className="sm-hint">Esc</span>
          </button>
          <span className="sm-label">악보 연습 · 준비</span>
        </div>

        <section className="sm-grid ready">
          <div className="sm-card lg">
            <h1 className="sm-h1-lg" style={{ overflowWrap: 'anywhere' }}>
              {chart.title}
            </h1>
            <div className="sm-chips">{metaChips}</div>
            {chart.variableTempo && (
              <div className="notice" role="status">
                변박 곡은 현재 지원하지 않습니다(고정 템포로 표시)
              </div>
            )}
            <div className="sm-triple">
              <div className="sm-tile flat">
                <span className="sm-tile-label">쓰는 패드</span>
                <span className="sm-tile-text">{usedPads.join(' · ') || '—'}</span>
              </div>
              <div className="sm-tile flat">
                <span className="sm-tile-label">카운트인</span>
                <span className="sm-tile-text">
                  {settings.countInBars}마디 · 클릭 {settings.countInBars * chart.beatsPerBar}번
                </span>
              </div>
              <div className="sm-tile flat">
                <span className="sm-tile-label">최근 기록</span>
                <span className="sm-tile-text">
                  {lastLog ? (
                    <>
                      정확도 {formatAccuracy(lastLog.summary.accuracy)} <small>· {relativeDay(lastLog.startedAt)}</small>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            </div>
            <div className="sm-toolbar" style={{ gap: 12, paddingTop: 8 }}>
              <button className="sm-btn primary lg" onClick={() => void begin()} disabled={!ready}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6 4l10 6-10 6z" />
                </svg>
                시작 <span className="sm-key">Enter</span>
              </button>
              <span className="sm-hint">
                시작하면 {settings.countInBars}마디 카운트인 뒤 커서가 움직입니다. 지금 쳐 보면 소리만 납니다.
              </span>
            </div>
          </div>

          <div className="sm-card">
            <span className="sm-label">준비 상태</span>
            <ul className="sm-check-list">
              <CheckItem ok={!missing.includes('stick')} name="스틱 연결" value={stickText} strong />
              <CheckItem
                ok={!missing.includes('firstSetup')}
                name="최초 설정"
                value={missing.includes('firstSetup') ? '필요' : '완료'}
              />
              <CheckItem
                ok={!missing.includes('preset')}
                name="프리셋"
                value={presetName ?? (missing.includes('preset') ? '적용 필요' : '—')}
              />
              {sensorMode && referenceStale && <CheckItem ok={false} name="기준 자세" value="재연결 후 다시 맞추세요" />}
            </ul>
            <Link to="/setup" state={{ returnTo, returnLabel: `악보 연습 · ${chart.title}` }} className="sm-btn" style={{ alignSelf: 'flex-start', color: 'var(--sm-text)' }}>
              세팅에서 맞추기
            </Link>
            <div className="sm-options">
              <span className="sm-label">연주 중 옵션</span>
              <label>
                <input type="checkbox" checked={settings.metronome} onChange={(e) => settings.setMetronome(e.target.checked)} />
                메트로놈 클릭을 곡 중에도 낸다
              </label>
              <label>
                <input type="checkbox" checked={settings.sheetPadCount} onChange={(e) => settings.setSheetPadCount(e.target.checked)} />
                드럼 패드 위에 다음 칠 박 번호를 보인다
              </label>
              <label>
                <input type="checkbox" checked={hasAcc} disabled readOnly />
                반주 재생{hasAcc ? '' : ' (반주 없음)'}
              </label>
            </div>
          </div>
        </section>

        <section className="sm-strip-panel" aria-label="악보 미리보기">
          <div className="sm-strip-body">
            <span className="sm-corner left">첫 페이지 · 정지</span>
            {strip}
          </div>
          <div className="sm-legend plain">
            <span>시작하면 커서가 왼쪽에서 오른쪽으로 갑니다. 커서가 음표에 닿는 순간이 칠 때입니다.</span>
            <span className="sm-legend-end">Enter 시작 · Esc 곡 선택</span>
          </div>
        </section>
      </main>
    );
  }

  const barNow = Math.min(bars, Math.max(1, Math.floor(Math.max(0, gridTimeOf(songMs, originMs)) / barMs) + 1));
  const ratio = chart.durationMs > 0 ? Math.min(1, Math.max(0, songMs / chart.durationMs)) : 0;
  const paused = pauseReason !== null;

  return (
    <main className="main sheet-mode">
      <div className={`sm-stack${paused ? ' sm-dim' : ''}`} aria-hidden={paused || undefined}>
        <div className="sm-head">
          <div className="sm-head-title">
            <span className="sm-label">악보 연습</span>
            <h1 style={{ overflowWrap: 'anywhere' }}>{chart.title}</h1>
          </div>
          <div className="sm-chips" style={{ paddingBottom: 4 }}>
            {metaChips}
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button className="sm-btn" onClick={() => pauseTo('user')} disabled={paused}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="5" y="4" width="3.5" height="12" rx="1" />
                <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
              </svg>
              일시정지 <span className="sm-hint">Esc</span>
            </button>
          </div>
        </div>

        <section className="sm-progress" aria-label="진행">
          <span className="sm-time">
            {formatSongTime(songMs)} <small>/ {formatDuration(chart.durationMs)}</small>
          </span>
          <div className="sm-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
            <div style={{ width: `${ratio * 100}%` }} />
          </div>
          <span>
            {barNow} <small>/ {bars} 마디</small>
          </span>
        </section>

        <div className="sm-judge-chips" aria-label="판정">
          <span className="sm-chip neutral sm-judge-chip">
            노트 {snap.judgedCount}/{activeSession.notes.length}
          </span>
          <span className="sm-chip neutral sm-judge-chip" style={{ color: 'var(--sm-perfect)' }}>
            P {snap.counts.PERFECT}
          </span>
          <span className="sm-chip neutral sm-judge-chip" style={{ color: 'var(--sm-good)' }}>
            G {snap.counts.GOOD}
          </span>
          <span className="sm-chip neutral sm-judge-chip" style={{ color: 'var(--sm-miss)' }}>
            M {snap.counts.MISS}
          </span>
          <span className="sm-chip neutral sm-judge-chip">채보 밖 {snap.strayHits}</span>
          <span className="sm-chip neutral sm-judge-chip">
            Δ {lastDelta === null ? '—' : `${lastDelta > 0 ? '+' : ''}${Math.round(lastDelta)} ms`}
          </span>
        </div>

        <div className="sm-play-grid">
          <section className="sm-strip-panel sm-play-sheet" aria-label="악보">
            <div className="sm-strip-body">
              <span className="sm-corner left">지난 음표 · 판정 색</span>
              {strip}
            </div>
            <div className="sm-legend">
              <span className="sm-legend-item">
                <span className="sm-dot" style={{ background: 'var(--sm-perfect)' }} aria-hidden="true" />
                Perfect
              </span>
              <span className="sm-legend-item">
                <span className="sm-dot" style={{ background: 'var(--sm-good)' }} aria-hidden="true" />
                Good
              </span>
              <span className="sm-legend-item">
                <span className="sm-dot" style={{ background: 'var(--sm-miss)' }} aria-hidden="true" />
                Miss
              </span>
              <span className="sm-legend-item">
                <span className="sm-dot sm" style={{ background: 'var(--sm-miss)' }} aria-hidden="true" />
                채보 밖 타격(감점 없음)
              </span>
              <span className="sm-legend-end">커서가 음표에 닿는 순간 치세요</span>
            </div>
          </section>

          <section className="sm-kit-panel" aria-label="드럼">
            <KitGuideView
              layout={settings.kitLayout}
              session={activeSession}
              getSongTime={getSongTime}
              hits={hits}
              showCount={settings.sheetPadCount}
              keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
            />
          </section>
        </div>

        <div className="sm-foot">
          <span>
            입력 {inputLabel} · 프리셋 {presetName ?? '—'} · 카운트인 {settings.countInBars}마디
          </span>
          {syncInfo?.begin != null && (
            <span>
              반주 동기 Δ {syncInfo.begin.toFixed(1)} ms
              {syncInfo.resume != null && <> · 재개 Δ {syncInfo.resume.toFixed(1)} ms</>}
            </span>
          )}
        </div>
      </div>

      {pauseReason !== null && (
        <PauseOverlay
          reason={pauseReason}
          canResume={ready}
          onResume={resume}
          onRestart={restart}
          onLeave={leave}
          returnTo={returnTo}
          pausedAtMs={pausedAtMs}
        />
      )}
    </main>
  );
}

/** 준비 상태 목록의 한 줄 */
function CheckItem({ ok, name, value, strong }: { ok: boolean; name: string; value: string; strong?: boolean }) {
  return (
    <li className={ok ? 'ok' : 'warn'}>
      <span className="sm-check-ico" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          {ok ? <path d="M4 10.5l4 4 8-9" /> : <path d="M10 5v6M10 14.5v.5" />}
        </svg>
      </span>
      <span className="sm-check-name">{name}</span>
      <span className={`sm-check-val${strong ? ' strong' : ''}`}>{value}</span>
    </li>
  );
}

/** 로그 시각 → "오늘"/"어제"/"N일 전" */
function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  return `${days}일 전`;
}
