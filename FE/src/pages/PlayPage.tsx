// 리듬 게임 (MODE-01, 설계 4-2). 곡 선택 → 준비 → 카운트인 → 플레이 → (일시정지) → 종료 → 결과.
// 엔진(RhythmSession)·레인(NoteHighway)·채보는 기존 코드. 이 페이지는 단계 전환, 입력 연결, HUD, 로그 저장을 맡는다.
// 화면 구조는 Claude Design UI로 교체 예정이라 최소로 둔다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { SongPicker } from '@/components/SongPicker';
import { useChartParam } from '@/components/useChartParam';
import { NoteHighway, type Popup } from '@/components/NoteHighway';
import { KitPlayView } from '@/components/KitPlayView';
import { PauseOverlay, type PauseReason } from '@/components/PauseOverlay';
import { usePauseTriggers } from '@/components/usePauseTriggers';
import { ReadinessNotice } from '@/components/ReadinessNotice';
import { useReadiness } from '@/components/useReadiness';
import { useHitFx } from '@/components/useHitFx';
import type { Chart } from '@/domain/chart';
import type { PadId } from '@/domain/pads';
import type { HitFx, InputSourceKind } from '@/domain/events';
import { KEY_MAP } from '@/domain/keyMap';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import { buildPlayLog, savePlayLog } from '@/engine/playLog';
import { PlayRecorder } from '@/engine/playRecorder';
import { startPlaySync } from '@/app/playSync';
import { diagSessionEnd, diagSessionPhase, diagSessionStart, reportHit } from '@/engine/diagReport';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/app/sources';
import { setSoundOnHit, unlockAudio } from '@/app/bootstrap';
import { audioEngine } from '@/audio/AudioEngine';
import { Accompaniment } from '@/audio/Accompaniment';
import { PlayClock } from '@/engine/sessionClock';
import { metronome } from '@/engine/Metronome';
import { useSettings, type GameView } from '@/store/settingsStore';

// loading: URL의 곡·채보를 불러오는 중(실패하면 같은 단계에서 오류 문구)
type Stage = 'select' | 'loading' | 'ready' | 'play';

/** 개발용: 설정하면 모든 곡에 이 반주 URL을 쓴다(로컬 BE에 S3가 없을 때) */
const ACCOMPANIMENT_OVERRIDE: string | undefined = import.meta.env.VITE_ACCOMPANIMENT_OVERRIDE || undefined;

const GAME_VIEWS: { id: GameView; label: string }[] = [
  { id: 'highway', label: '노트 하이웨이' },
  { id: 'kit', label: '킷 위 연주' },
];

const DIFF_LABEL: Record<Chart['difficulty'], string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

function barsOf(c: Chart): number {
  return Math.round(c.durationMs / ((60_000 / c.bpm) * c.beatsPerBar));
}

export function PlayPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const param = useChartParam();
  const [stage, setStage] = useState<Stage>(param.status === 'none' ? 'select' : 'loading');
  const [chart, setChart] = useState<Chart | null>(null);
  const [session, setSession] = useState<RhythmSession | null>(null);
  const [hud, setHud] = useState<SessionSnapshot | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  // 반주 디코드 단계 표시·오류, 동기 Δ 디버그 표시
  const [accStatus, setAccStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [accError, setAccError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<{ begin: number | null; resume: number | null } | null>(null);
  const [acc] = useState(() => new Accompaniment(audioEngine));
  const clockRef = useRef<PlayClock | null>(null);
  // 준비 조건 미충족이면 시작하지 못한다(키보드 전용은 면제). 키 핸들러·begin이 최신 값을 보도록 ref에도 둔다
  const { ready } = useReadiness();
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

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
  // 킷 뷰 타격 이펙트 (useHitFx가 live 스토어 타격을 기록). 하이웨이 뷰에서는 쓰지 않는다
  const hitFx = useRef(new Map<PadId, HitFx>());
  useHitFx(hitFx);
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
      ss.onJudgement((e) => {
        recorder.current.judgement(e);
        popups.current.push({ judgement: e.judgement, deltaMs: e.deltaMs, pad: e.pad, at: performance.now() });
        setHud(ss.snapshot());
      });
      flashes.current.clear();
      hitFx.current.clear();
      popups.current = [];
      recorder.current.reset();
      finishing.current = false;
      setChart(c);
      setSession(ss);
      setHud(ss.snapshot());
      setPauseReason(null);
      setStage('ready');
    },
    [settings.timing, settings.countInBars, settings.audioOffsetMs],
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
    setSyncInfo({ ...clock.sync });
    inputManager.setCandidateProvider((t) => ss.candidates(t));
    diagSessionStart(ss, 'RHYTHM', { windows: useSettings.getState().timing, audioOffsetMs: useSettings.getState().audioOffsetMs });
    setStage('play');
  }, [acc]);

  const toSelect = useCallback(() => {
    diagSessionEnd('left');
    clockRef.current?.stop();
    metronome.unlock();
    inputManager.setCandidateProvider(null);
    setPauseReason(null);
    setSession(null);
    setChart(null);
    setHud(null);
    setStage('select');
    clearParam();
  }, [clearParam]);

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
    setSyncInfo({ ...clock.sync });
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
    hitFx.current.clear();
    popups.current = [];
    recorder.current.reset();
    finishing.current = false;
    startedAt.current = new Date();
    setHud(ss.snapshot());
    setSyncInfo({ ...clock.sync });
    setPauseReason(null);
  }, []);

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
      });
      savePlayLog(log);
      // 서버 업로드는 결과 화면을 막지 않는다(설계 COACH-002 D1)
      void startPlaySync(log.playId);
      navigate(`/result/${log.playId}`);
    },
    [navigate, inputSource, settings.timing],
  );

  // 매 프레임: 세션 시계(Miss 처리·종료 감지·박 클릭 예약)는 PlayClock, 여기서는 HUD 4Hz 갱신
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      const st = stageRef.current;
      if (st === 'ready') {
        if (e.code === 'Enter') void begin();
        else toSelect();
      } else if (st === 'play') {
        if (pauseRef.current !== null) resume();
        else if (e.code === 'Escape') pauseTo('user');
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [begin, toSelect, resume, pauseTo]);

  if (stage === 'loading' && !chart) {
    return (
      <main className="main">
        <div className="card col" style={{ maxWidth: 480 }}>
          {accStatus === 'error' ? (
            <>
              <div className="notice error" role="alert">
                {accError ?? '반주를 불러오지 못했습니다.'}
              </div>
              <div className="row">
                {param.loaded && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      acc.unload();
                      setAccStatus('idle');
                      if (param.loaded) choose(param.loaded.chart);
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
          ) : param.status === 'error' ? (
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
              <span className="dim">{accStatus === 'loading' ? '반주 불러오는 중' : '채보를 불러오는 중'}</span>
            </div>
          )}
        </div>
      </main>
    );
  }

  if (stage === 'select' || !chart || !session) {
    return (
      <main className="main">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h1>리듬 게임</h1>
          <span className="small dim">곡을 고르면 준비 화면으로 갑니다</span>
        </div>
        <div className="card col" style={{ marginBottom: 16 }}>
          <h3>게임 뷰</h3>
          <div className="row" role="group" aria-label="게임 뷰">
            {GAME_VIEWS.map((v) => (
              <button
                key={v.id}
                className={settings.gameView === v.id ? 'btn-primary' : 'btn-ghost'}
                aria-pressed={settings.gameView === v.id}
                onClick={() => settings.setGameView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <span className="small dim">
            {settings.gameView === 'kit'
              ? '세팅한 킷 배치 위에서 링이 줄어들어 패드에 닿을 때 칩니다.'
              : '노트가 레인을 따라 판정선으로 떨어집니다.'}
          </span>
        </div>
        <div className="grid-2">
          <div className="card col">
            <h3>곡 선택</h3>
            <SongPicker mode="play" onSelect={param.select} />
          </div>
          <div className="card col">
            <h3>현재 설정</h3>
            <table className="plain">
              <tbody>
                <tr>
                  <td className="dim">판정 폭</td>
                  <td>
                    Perfect ±{settings.timing.perfectMs}ms · Good ±{settings.timing.goodMs}ms
                  </td>
                </tr>
                <tr>
                  <td className="dim">노트 낙하 시간</td>
                  <td>{settings.scrollMs}ms</td>
                </tr>
                <tr>
                  <td className="dim">카운트인</td>
                  <td>{settings.countInBars}마디</td>
                </tr>
                <tr>
                  <td className="dim">메트로놈</td>
                  <td>{settings.metronome ? '켬' : '끔'}</td>
                </tr>
                <tr>
                  <td className="dim">입력</td>
                  <td>{inputSource}</td>
                </tr>
              </tbody>
            </table>
            <Link to="/setup" className="small">
              세팅에서 바꾸기
            </Link>
            <p className="small faint">
              매핑 키로 칩니다. Enter 시작 · Esc 일시정지. 채보에 없는 타격은 감점이 없습니다.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const snap = hud ?? session.snapshot();
  const progress = Math.min(1, Math.max(0, snap.songTimeMs / chart.durationMs));
  const statusLabel =
    snap.status === 'countin' ? '카운트인' : snap.status === 'paused' ? '일시정지' : snap.status === 'playing' ? '연주 중' : '준비';

  return (
    <main className="main wide">
      <div className="play-layout">
        <div style={{ position: 'relative', minHeight: 480 }}>
          {settings.gameView === 'kit' ? (
            <KitPlayView
              session={session}
              layout={settings.kitLayout}
              scrollMs={settings.scrollMs}
              hits={hitFx}
              keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
              onFrame={onFrame}
            />
          ) : (
            <NoteHighway
              session={session}
              scrollMs={settings.scrollMs}
              flashes={flashes}
              popups={popups}
              keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
              onFrame={onFrame}
            />
          )}
          {stage === 'ready' && (
            <div className="overlay">
              <h2>{chart.title}</h2>
              <p className="dim">
                {DIFF_LABEL[chart.difficulty]} · {chart.bpm} BPM · {barsOf(chart)}마디
              </p>
              <ReadinessNotice returnTo={returnTo} compact />
              <button className="btn-primary btn-lg" onClick={() => void begin()} disabled={!ready}>
                시작 (Enter)
              </button>
              <button className="btn-ghost" onClick={toSelect}>
                곡 선택으로 (Esc)
              </button>
              <p className="small faint">쳐 보면 소리만 납니다. 시작하면 {settings.countInBars}마디 카운트인 뒤 노트가 내려옵니다.</p>
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

        <aside className="card hud">
          <div>
            <strong>{chart.title}</strong>
            <div className="small dim">
              {DIFF_LABEL[chart.difficulty]} · {chart.bpm} BPM · {statusLabel}
            </div>
          </div>
          <div>
            <div className="score">{snap.score}</div>
            <div className="small dim">/ {snap.maxScore}</div>
          </div>
          <div className="combo">
            {snap.combo} 콤보 <span className="small dim">(최대 {snap.maxCombo})</span>
          </div>
          <div className="counts">
            <span>Perfect</span>
            <span>{snap.counts.PERFECT}</span>
            <span>Good</span>
            <span>{snap.counts.GOOD}</span>
            <span>Miss</span>
            <span>{snap.counts.MISS}</span>
            <span className="dim">채보 외</span>
            <span>{snap.strayHits}</span>
          </div>
          <div className="progress" aria-label="진행">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="small dim">
            {snap.judgedCount} / {session.notes.length} 노트
          </div>
          {stage === 'play' && syncInfo?.begin != null && (
            <div className="small faint">
              반주 동기 Δ {syncInfo.begin.toFixed(1)}ms
              {syncInfo.resume != null && <> · 재개 Δ {syncInfo.resume.toFixed(1)}ms</>}
            </div>
          )}
          {stage === 'play' && pauseReason === null && (
            <button className="btn-ghost small" onClick={() => pauseTo('user')}>
              일시정지 (Esc)
            </button>
          )}
        </aside>
      </div>
    </main>
  );
}
