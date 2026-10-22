// 악보 연주 (MODE-003 설계 4-1~4-4). 곡 선택 → 불러오기(채보·반주) → 준비 → 카운트인 → 연주 → 결과 페이지.
// PlayPage와 같은 골격(PlayClock·반주·메트로놈 잠금)이고 뷰만 가로 스트립(SheetStrip)이다.
// 점수·콤보는 보이지 않고 노트 색과 판정 수만 보인다. 일시정지는 Esc·스틱 끊김·메뉴 요청 3종(PauseOverlay).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { SongPicker } from '@/components/SongPicker';
import { useChartParam } from '@/components/useChartParam';
import { SheetStrip } from '@/components/SheetStrip';
import { PauseOverlay, type PauseReason } from '@/components/PauseOverlay';
import { ReadinessNotice } from '@/components/ReadinessNotice';
import { useReadiness } from '@/components/useReadiness';
import type { Chart } from '@/domain/chart';
import type { Judgement } from '@/domain/judgement';
import type { InputSourceKind } from '@/domain/events';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import { buildPlayLog, savePlayLog, toLoggedHit, type LoggedHit } from '@/engine/playLog';
import { pushTelemetry } from '@/engine/telemetry';
import { PlayClock } from '@/engine/sessionClock';
import { metronome } from '@/engine/Metronome';
import { inputManager } from '@/app/sources';
import { setSoundOnHit, unlockAudio } from '@/app/bootstrap';
import { audioEngine } from '@/audio/AudioEngine';
import { Accompaniment } from '@/audio/Accompaniment';
import type { LoadedChart } from '@/store/songStore';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

// 단계는 URL 파라미터 상태·세션에서 렌더 중 파생한다. paused는 pauseReason으로 표시
type Stage = 'select' | 'loading' | 'ready' | 'play';

/** 개발용: 설정하면 모든 곡에 이 반주 URL을 쓴다(로컬 BE에 S3가 없을 때) */
const ACCOMPANIMENT_OVERRIDE: string | undefined = import.meta.env.VITE_ACCOMPANIMENT_OVERRIDE || undefined;

const DIFF_LABEL: Record<Chart['difficulty'], string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

/** HUD 갱신 간격(ms) */
const HUD_INTERVAL_MS = 250;

function barsOf(c: Chart): number {
  return Math.round(c.durationMs / ((60_000 / c.bpm) * c.beatsPerBar));
}

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
  const param = useChartParam();
  const { status: paramStatus, loaded: paramLoaded } = param;
  const [acc] = useState(() => new Accompaniment(audioEngine));
  const [accResult, setAccResult] = useState<AccResult | null>(null);
  // 연주 중인 세션. 연주 중 설정이 바뀌어도 세션을 새로 만들지 않도록 begin 때 고정한다
  const [playSession, setPlaySession] = useState<RhythmSession | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const [hud, setHud] = useState<SessionSnapshot | null>(null);
  const [noteStates, setNoteStates] = useState<(Judgement | null)[]>([]);
  const [strays, setStrays] = useState<{ timeMs: number }[]>([]);
  const [syncInfo, setSyncInfo] = useState<{ begin: number | null; resume: number | null } | null>(null);
  const clockRef = useRef<PlayClock | null>(null);

  // 준비 조건 미충족이면 시작·재개하지 못한다(키보드 전용은 면제)
  const { ready } = useReadiness();
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

  const hits = useRef<LoggedHit[]>([]);
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

  // 판정 → 노트 색(새 배열로 갱신: SheetStrip이 렌더 후 ref에 복사한다) · HUD
  useEffect(() => {
    if (!activeSession) return;
    return activeSession.onJudgement((e) => {
      setNoteStates((prev) => {
        const next = prev.slice();
        next[e.noteIndex] = e.judgement;
        return next;
      });
      setHud(activeSession.snapshot());
    });
  }, [activeSession]);

  // 타격: 즉시 발음 → 햅틱 → 판정 → 로그·텔레메트리. 일시정지 중에는 세션에 넣지 않는다
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.pad) {
        hit.tAudio = audioEngine.trigger(hit.pad, hit.velocity);
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
        const lh = toLoggedHit(hit);
        if (ev) {
          lh.judgement = ev.judgement;
          lh.matchedNoteIndex = ev.noteIndex;
          lh.deltaMs = ev.deltaMs ?? undefined;
        } else if (hit.pad) {
          // 채보 밖 타격: 악보에 작은 점으로 남긴다. 판정과 같은 기준으로 오디오 오프셋을 뺀다
          const timeMs = ss.songTime(hit.tHit) - useSettings.getState().audioOffsetMs;
          setStrays((prev) => [...prev, { timeMs }]);
        }
        hits.current.push(lh);
      }
      pushTelemetry(hit, ev ? { judgement: ev.judgement, deltaMs: ev.deltaMs ?? undefined } : undefined);
    });
  }, []);

  const pauseTo = useCallback((reason: PauseReason) => {
    const clock = clockRef.current;
    if (stageRef.current !== 'play' || !clock || pauseRef.current !== null) return;
    clock.pause(reason);
    // 같은 틱의 중복 트리거(끊김 + 메뉴)를 막기 위해 ref도 바로 갱신한다
    pauseRef.current = reason;
    setPauseReason(reason);
  }, []);

  // 연결 끊김(둘 다 false로 전이, 센서 모드만)·메뉴 요청 → 자동 일시정지. 스토어 구독이라 effect 안에서 setState하지 않는다
  useEffect(() => {
    return useLive.subscribe((s, prev) => {
      const was = prev.connected[0] || prev.connected[1];
      const now = s.connected[0] || s.connected[1];
      if (was && !now && useSettings.getState().sensorKind !== 'none') pauseTo('disconnected');
      if (s.pauseRequested === 'menu') {
        pauseTo('menu');
        useLive.setState({ pauseRequested: null });
      }
    });
  }, [pauseTo]);

  const finish = useCallback(
    (ss: RhythmSession) => {
      if (finishing.current) return;
      finishing.current = true;
      clockRef.current?.stop();
      metronome.unlock();
      inputManager.setCandidateProvider(null);
      const log = buildPlayLog({
        mode: 'SHEET',
        snapshot: ss.snapshot(),
        notes: ss.notes,
        hits: hits.current,
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
      navigate(`/result/${log.playId}`, { replace: true });
    },
    [navigate, inputSource, settings.timing],
  );
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const resetRun = useCallback((ss: RhythmSession) => {
    hits.current = [];
    finishing.current = false;
    startedAt.current = new Date();
    setNoteStates(new Array<Judgement | null>(ss.notes.length).fill(null));
    setStrays([]);
    setHud(ss.snapshot());
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
    setPlaySession(ss);
  }, [acc, resetRun]);

  const resume = useCallback(() => {
    const clock = clockRef.current;
    if (!clock || !readyRef.current || pauseRef.current === null) return;
    clock.resume();
    setSyncInfo({ ...clock.sync });
    setPauseReason(null);
  }, []);

  const restart = useCallback(() => {
    const clock = clockRef.current;
    const ss = sessionRef.current;
    if (!clock || !ss) return;
    // 재시작은 카운트인부터. 메트로놈 잠금은 유지한다
    clock.restart();
    resetRun(ss);
    setSyncInfo({ ...clock.sync });
  }, [resetRun]);

  /** 나가기: 기록 없이 준비 화면으로(곡 선택 유지) */
  const leave = useCallback(() => {
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      const st = stageRef.current;
      if (st === 'ready') {
        if (e.code === 'Enter') void begin();
        else toSelect();
      } else if (st === 'play') {
        if (pauseRef.current !== null) resume();
        else if (e.code === 'Escape') pauseTo('user');
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [begin, toSelect, resume, pauseTo]);

  // 스트립이 매 프레임 읽는 곡 시각. 연주 전·후에는 null(정지)
  const getSongTime = useCallback(
    () => (stageRef.current === 'play' ? (clockRef.current?.songTime() ?? null) : null),
    [],
  );

  if (stage === 'loading') {
    return (
      <main className="main">
        <div className="card col" style={{ maxWidth: 480 }}>
          {accError ? (
            <>
              <div className="notice error" role="alert">
                {accError}
              </div>
              <div className="row">
                {paramLoaded && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      acc.unload();
                      setAccResult({ loaded: paramLoaded, ok: true });
                    }}
                  >
                    반주 없이 계속
                  </button>
                )}
                <button className="btn-ghost" onClick={toSelect}>
                  곡 선택으로
                </button>
              </div>
            </>
          ) : paramStatus === 'error' ? (
            <>
              <div className="notice error" role="alert">
                {param.error ?? '채보를 불러오지 못했습니다.'}
              </div>
              <button className="btn-ghost" onClick={toSelect}>
                곡 선택으로
              </button>
            </>
          ) : (
            <div className="row">
              <span className="spinner" aria-label="불러오는 중" />
              <span className="dim">{accLoading ? '반주 불러오는 중' : '채보를 불러오는 중'}</span>
            </div>
          )}
        </div>
      </main>
    );
  }

  if (stage === 'select' || !chart || !activeSession) {
    return (
      <main className="main">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h1>악보 연주</h1>
          <span className="small dim">곡을 고르면 준비 화면으로 갑니다</span>
        </div>
        <div className="grid-2">
          <div className="card col">
            <h3>곡 선택</h3>
            <SongPicker mode="sheet" onSelect={param.select} />
          </div>
          <div className="card col">
            <h3>악보 연주란</h3>
            <p className="small dim">
              반주에 맞춰 악보가 오른쪽에서 왼쪽으로 흐르고, 고정 기준선이 지금 칠 위치입니다. 점수와 콤보는 보이지
              않고, 칠 때마다 음표가 판정 색으로 바뀝니다. 끝나면 결과 페이지에서 약한 패드·구간을 짚어 줍니다.
            </p>
            <p className="small dim">
              카운트인 {settings.countInBars}마디 · 메트로놈 {settings.metronome ? '켬' : '끔'} · 입력 {inputSource}{' '}
              <Link to="/setup">세팅에서 바꾸기</Link>
            </p>
            <p className="small faint">Enter 시작 · Esc 일시정지.</p>
          </div>
        </div>
      </main>
    );
  }

  const snap = hud ?? activeSession.snapshot();
  const hasAcc = acc.state === 'ready' || acc.state === 'playing' || acc.state === 'paused';

  return (
    <main className="main">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1>악보 연주</h1>
          <div className="small dim">
            {chart.title} · {DIFF_LABEL[chart.difficulty]} · {chart.bpm} BPM · {barsOf(chart)}마디
          </div>
        </div>
        {stage === 'play' && pauseReason === null && (
          <button className="btn-ghost small" onClick={() => pauseTo('user')}>
            일시정지 (Esc)
          </button>
        )}
      </div>

      {stage === 'ready' && (
        <div className="card col" style={{ marginBottom: 12 }}>
          <h2>{chart.title}</h2>
          <p className="dim">
            {DIFF_LABEL[chart.difficulty]} · {chart.bpm} BPM · {barsOf(chart)}마디 · {hasAcc ? '반주 있음' : '반주 없음'}
          </p>
          {chart.variableTempo && (
            <div className="notice" role="status">
              변박 곡은 현재 지원하지 않습니다(고정 템포로 표시)
            </div>
          )}
          <ReadinessNotice returnTo={returnTo} compact />
          <div className="row">
            <button className="btn-primary btn-lg" onClick={() => void begin()} disabled={!ready}>
              시작 (Enter)
            </button>
            <button className="btn-ghost" onClick={toSelect}>
              곡 선택으로 (Esc)
            </button>
          </div>
          <p className="small faint">쳐 보면 소리만 납니다. 시작하면 {settings.countInBars}마디 카운트인 뒤 악보가 흐릅니다.</p>
        </div>
      )}

      <div className="sheet-wrap sheet-play">
        <SheetStrip
          chart={chart}
          noteStates={noteStates}
          strayHits={strays}
          getSongTime={getSongTime}
          countInMs={activeSession.countInMs}
        />
        {stage === 'play' && (
          <div className="sheet-hud">
            <span>
              {snap.judgedCount} / {activeSession.notes.length} 노트
            </span>
            <span>Perfect {snap.counts.PERFECT}</span>
            <span>Good {snap.counts.GOOD}</span>
            <span>Miss {snap.counts.MISS}</span>
            <span className="dim">채보 외 {snap.strayHits}</span>
            {syncInfo?.begin != null && (
              <span className="small faint">
                반주 동기 Δ {syncInfo.begin.toFixed(1)}ms
                {syncInfo.resume != null && <> · 재개 Δ {syncInfo.resume.toFixed(1)}ms</>}
              </span>
            )}
          </div>
        )}
        {stage === 'play' && pauseReason !== null && (
          <PauseOverlay
            reason={pauseReason}
            canResume={ready}
            onResume={resume}
            onRestart={restart}
            onLeave={leave}
            returnTo={returnTo}
          />
        )}
      </div>
    </main>
  );
}
