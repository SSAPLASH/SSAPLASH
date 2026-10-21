// 리듬 게임 (MODE-01, 설계 4-2). 곡 선택 → 준비 → 카운트인 → 플레이 → (중단 확인) → 종료 → 결과.
// 엔진(RhythmSession)·레인(NoteHighway)·채보는 기존 코드. 이 페이지는 단계 전환, 입력 연결, HUD, 로그 저장을 맡는다.
// 화면 구조는 Claude Design UI로 교체 예정이라 최소로 둔다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { NoteHighway, type Popup } from '@/components/NoteHighway';
import { KitPlayView } from '@/components/KitPlayView';
import { useHitFx } from '@/components/useHitFx';
import { BUILTIN_CHARTS, type Chart } from '@/domain/chart';
import { STICK_PADS, type PadId } from '@/domain/pads';
import { isProfileComplete } from '@/domain/calibration';
import type { HitFx, InputSourceKind } from '@/domain/events';
import { RhythmSession, type SessionSnapshot } from '@/engine/RhythmSession';
import { buildPlayLog, savePlayLog, toLoggedHit, type LoggedHit } from '@/engine/playLog';
import { pushTelemetry } from '@/engine/telemetry';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/app/sources';
import { setSoundOnHit, unlockAudio } from '@/app/bootstrap';
import { audioEngine } from '@/audio/AudioEngine';
import { useSettings, type GameView } from '@/store/settingsStore';

type Stage = 'select' | 'ready' | 'play';

/** 박 클릭을 미리 예약하는 선행 시간. 프레임 간격(16ms)보다 넉넉하게 */
const CLICK_LOOKAHEAD_MS = 200;

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
  const [stage, setStage] = useState<Stage>('select');
  const [chart, setChart] = useState<Chart | null>(null);
  const [session, setSession] = useState<RhythmSession | null>(null);
  const [hud, setHud] = useState<SessionSnapshot | null>(null);
  const [abortOpen, setAbortOpen] = useState(false);

  // 그리기 루프·입력 리스너가 최신 상태를 보도록 ref에 복사 (렌더 중 ref 쓰기 회피)
  const stageRef = useRef<Stage>('select');
  const sessionRef = useRef<RhythmSession | null>(null);
  useEffect(() => {
    stageRef.current = stage;
    sessionRef.current = session;
  }, [stage, session]);

  const flashes = useRef(new Map<PadId, number>());
  const popups = useRef<Popup[]>([]);
  const hits = useRef<LoggedHit[]>([]);
  // 킷 뷰 타격 이펙트 (useHitFx가 live 스토어 타격을 기록). 하이웨이 뷰에서는 쓰지 않는다
  const hitFx = useRef(new Map<PadId, HitFx>());
  useHitFx(hitFx);
  const startedAt = useRef(new Date());
  const nextBeat = useRef(0);
  const lastHud = useRef(0);
  const finishing = useRef(false);

  const calDone = isProfileComplete(settings.profile, STICK_PADS);
  const inputSource: InputSourceKind = settings.sensorKind === 'none' ? 'keyboard' : settings.sensorKind;

  // 진입: 공용 발음을 끄고 이 페이지가 직접 소리·텔레메트리를 낸다. 떠날 때 되돌린다
  useEffect(() => {
    setSoundOnHit(false);
    return () => {
      setSoundOnHit(true);
      inputManager.setCandidateProvider(null);
    };
  }, []);

  // 타격: 즉시 발음(D6) → 햅틱 → 플래시 → 판정 → 로그·텔레메트리
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.pad) {
        hit.tAudio = audioEngine.trigger(hit.pad, hit.velocity);
        inputManager.haptic(hit.stickId, hit.velocity * 2, 30);
        flashes.current.set(hit.pad, performance.now());
      }
      const ss = sessionRef.current;
      const active =
        ss && stageRef.current === 'play' && (ss.currentStatus === 'playing' || ss.currentStatus === 'countin');
      const ev = active ? ss.handleHit(hit) : null;
      if (active) {
        const lh = toLoggedHit(hit);
        if (ev) {
          lh.judgement = ev.judgement;
          lh.matchedNoteIndex = ev.noteIndex;
          lh.deltaMs = ev.deltaMs ?? undefined;
        }
        hits.current.push(lh);
      }
      pushTelemetry(hit, ev ? { judgement: ev.judgement, deltaMs: ev.deltaMs ?? undefined } : undefined);
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
        popups.current.push({ judgement: e.judgement, deltaMs: e.deltaMs, pad: e.pad, at: performance.now() });
        setHud(ss.snapshot());
      });
      flashes.current.clear();
      hitFx.current.clear();
      popups.current = [];
      hits.current = [];
      nextBeat.current = 0;
      finishing.current = false;
      setChart(c);
      setSession(ss);
      setHud(ss.snapshot());
      setAbortOpen(false);
      setStage('ready');
    },
    [settings.timing, settings.countInBars, settings.audioOffsetMs],
  );

  // 결과 화면 "다시 하기"로 들어오면 같은 곡 준비 화면
  useEffect(() => {
    const songId = (location.state as { songId?: string } | null)?.songId;
    const c = songId ? BUILTIN_CHARTS.find((x) => x.songId === songId) : undefined;
    if (c) choose(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const begin = useCallback(async () => {
    const ss = sessionRef.current;
    if (!ss || stageRef.current !== 'ready') return;
    await unlockAudio();
    startedAt.current = new Date();
    ss.start();
    inputManager.setCandidateProvider((t) => ss.candidates(t));
    setStage('play');
  }, []);

  const toSelect = useCallback(() => {
    inputManager.setCandidateProvider(null);
    setAbortOpen(false);
    setSession(null);
    setChart(null);
    setHud(null);
    setStage('select');
  }, []);

  const openAbort = useCallback(() => {
    sessionRef.current?.pause();
    setAbortOpen(true);
  }, []);

  const continueGame = useCallback(() => {
    sessionRef.current?.resume();
    setAbortOpen(false);
  }, []);

  const finish = useCallback(
    (ss: RhythmSession) => {
      if (finishing.current) return;
      finishing.current = true;
      inputManager.setCandidateProvider(null);
      const log = buildPlayLog({
        snapshot: ss.snapshot(),
        notes: ss.notes,
        hits: hits.current,
        chart: ss.chart,
        inputSource,
        timing: settings.timing,
        profile: settings.profile,
        startedAt: startedAt.current,
      });
      savePlayLog(log);
      navigate(`/result/${log.playId}`);
    },
    [navigate, inputSource, settings.timing, settings.profile],
  );

  // 매 프레임: Miss 처리·종료 감지·박 클릭 예약·HUD 4Hz 갱신
  const onFrame = useCallback(
    (now: number) => {
      const ss = sessionRef.current;
      if (!ss || stageRef.current !== 'play') return;
      ss.tick(now);
      const st = ss.currentStatus;
      if (st === 'finished') {
        finish(ss);
        return;
      }
      if (st !== 'paused') {
        const t = ss.songTime(now);
        const beatMs = ss.beatMs;
        const beatsPerBar = ss.chart.beatsPerBar;
        // 박 i의 곡 시각 = −카운트인 + i×박. 카운트인 클릭은 항상, 플레이 중 클릭은 메트로놈 설정
        for (;;) {
          const bt = -ss.countInMs + nextBeat.current * beatMs;
          if (bt > t + CLICK_LOOKAHEAD_MS || bt > ss.chart.durationMs) break;
          if (bt >= t - 50 && (bt < 0 || settings.metronome)) {
            audioEngine.click(now + (bt - t), nextBeat.current % beatsPerBar === 0);
          }
          nextBeat.current += 1;
        }
      }
      if (now - lastHud.current > 250) {
        lastHud.current = now;
        setHud(ss.snapshot(now));
      }
    },
    [finish, settings.metronome],
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
        if (abortOpen) continueGame();
        else if (e.code === 'Escape') openAbort();
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abortOpen, begin, toSelect, openAbort, continueGame]);

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
            <div className="chart-list" style={{ maxWidth: 'none' }}>
              {BUILTIN_CHARTS.map((c) => (
                <button key={c.songId} className="card chart-item" onClick={() => choose(c)}>
                  <span className="col" style={{ gap: 2 }}>
                    <strong>{c.title}</strong>
                    <span className="small dim">
                      {c.bpm} BPM · {barsOf(c)}마디 · 노트 {c.notes.length}개
                    </span>
                  </span>
                  <span className="diff">{DIFF_LABEL[c.difficulty]}</span>
                </button>
              ))}
            </div>
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
            {settings.sensorKind !== 'none' && !calDone && (
              <p className="small dim">
                캘리브레이션이 없어 센서 타격은 판정되지 않습니다. 키보드 타격은 판정됩니다.{' '}
                <Link to="/calibration">캘리브레이션 하기</Link>
              </p>
            )}
            <p className="small faint">
              매핑 키로 칩니다. Enter 시작 · Esc 중단 확인. 채보에 없는 타격은 감점이 없습니다.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const snap = hud ?? session.snapshot();
  const progress = Math.min(1, Math.max(0, snap.songTimeMs / chart.durationMs));
  const statusLabel =
    snap.status === 'countin' ? '카운트인' : snap.status === 'paused' ? '멈춤' : snap.status === 'playing' ? '연주 중' : '준비';

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
              keyMap={KEYBOARD_INPUT_ENABLED ? settings.keyMap : undefined}
              onFrame={onFrame}
            />
          ) : (
            <NoteHighway
              session={session}
              scrollMs={settings.scrollMs}
              flashes={flashes}
              popups={popups}
              keyMap={settings.keyMap}
              onFrame={onFrame}
            />
          )}
          {stage === 'ready' && (
            <div className="overlay">
              <h2>{chart.title}</h2>
              <p className="dim">
                {DIFF_LABEL[chart.difficulty]} · {chart.bpm} BPM · {barsOf(chart)}마디
              </p>
              <button className="btn-primary btn-lg" onClick={() => void begin()}>
                시작 (Enter)
              </button>
              <button className="btn-ghost" onClick={toSelect}>
                곡 선택으로 (Esc)
              </button>
              <p className="small faint">쳐 보면 소리만 납니다. 시작하면 {settings.countInBars}마디 카운트인 뒤 노트가 내려옵니다.</p>
            </div>
          )}
          {abortOpen && (
            <div className="overlay" role="dialog" aria-label="중단 확인">
              <h2>연주를 중단할까요?</h2>
              <p className="dim">중단하면 이번 연주는 기록되지 않습니다.</p>
              <div className="row">
                <button className="btn-primary" onClick={continueGame}>
                  계속 (Enter)
                </button>
                <button className="btn-danger" onClick={toSelect}>
                  중단
                </button>
              </div>
            </div>
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
          {stage === 'play' && !abortOpen && (
            <button className="btn-ghost small" onClick={openAbort}>
              중단 (Esc)
            </button>
          )}
        </aside>
      </div>
    </main>
  );
}
