// 악보 연습 (MODE-sheet-practice). 곡 선택 → 준비 → 카운트인 → 연주 → 같은 화면에서 피드백.
// 세션·입력·카운트인·메트로놈 연결은 PlayPage와 같다. 다른 점: 점수·콤보를 보여주지 않고,
// 결과 화면으로 가지 않고, 노트 판정을 격자 악보에 색으로 남긴다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FeedbackCards } from '@/components/FeedbackCards';
import { SheetGrid } from '@/components/SheetGrid';
import { BUILTIN_CHARTS, type Chart } from '@/domain/chart';
import { buildFeedback, summarizeByPad } from '@/domain/feedback';
import type { Judgement } from '@/domain/judgement';
import { STICK_PADS, PAD_META } from '@/domain/pads';
import { isProfileComplete } from '@/domain/calibration';
import type { InputSourceKind } from '@/domain/events';
import { buildSheet, positionAt } from '@/domain/sheet';
import { RhythmSession, type JudgementEvent, type SessionStatus } from '@/engine/RhythmSession';
import { buildPlayLog, savePlayLog, toLoggedHit, type LoggedHit, type PlayLog } from '@/engine/playLog';
import { pushTelemetry } from '@/engine/telemetry';
import { inputManager } from '@/app/sources';
import { setSoundOnHit, unlockAudio } from '@/app/bootstrap';
import { audioEngine } from '@/audio/AudioEngine';
import { metronome } from '@/engine/Metronome';
import { useSettings } from '@/store/settingsStore';

type Stage = 'select' | 'ready' | 'play' | 'feedback';

/** 박 클릭을 미리 예약하는 선행 시간. 프레임 간격(16ms)보다 넉넉하게 */
const CLICK_LOOKAHEAD_MS = 200;

const DIFF_LABEL: Record<Chart['difficulty'], string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: '준비',
  countin: '카운트인',
  playing: '연주 중',
  paused: '멈춤',
  finished: '끝',
};

const barsOf = (c: Chart) => Math.round(c.durationMs / ((60_000 / c.bpm) * c.beatsPerBar));

export function SheetPage() {
  const settings = useSettings();
  const [stage, setStage] = useState<Stage>('select');
  const [chart, setChart] = useState<Chart | null>(null);
  const [session, setSession] = useState<RhythmSession | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [songTime, setSongTime] = useState<number | null>(null);
  const [noteStates, setNoteStates] = useState<(Judgement | null)[]>([]);
  const [strays, setStrays] = useState<{ timeMs: number }[]>([]);
  const [last, setLast] = useState<JudgementEvent | null>(null);
  const [abortOpen, setAbortOpen] = useState(false);
  const [log, setLog] = useState<PlayLog | null>(null);
  const [focusBar, setFocusBar] = useState<number | undefined>(undefined);

  // 그리기 루프·입력 리스너가 최신 상태를 보도록 ref에 복사
  const stageRef = useRef<Stage>('select');
  const sessionRef = useRef<RhythmSession | null>(null);
  useEffect(() => {
    stageRef.current = stage;
    sessionRef.current = session;
  }, [stage, session]);

  const hits = useRef<LoggedHit[]>([]);
  const startedAt = useRef<Date | null>(null);
  const nextBeat = useRef(0);
  const finishing = useRef(false);

  const calDone = isProfileComplete(settings.profile, STICK_PADS);
  const inputSource: InputSourceKind = settings.sensorKind === 'none' ? 'keyboard' : settings.sensorKind;

  const model = useMemo(() => (chart ? buildSheet(chart) : null), [chart]);

  // 진입: 공용 발음을 끄고 이 페이지가 직접 소리·텔레메트리를 낸다. 떠날 때 되돌린다
  useEffect(() => {
    setSoundOnHit(false);
    return () => {
      setSoundOnHit(true);
      inputManager.setCandidateProvider(null);
    };
  }, []);

  // 타격: 즉시 발음(D6) → 햅틱 → 판정 → 로그·텔레메트리
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.pad) {
        hit.tAudio = audioEngine.trigger(hit.pad, hit.velocity);
        inputManager.haptic(hit.stickId, hit.velocity * 2, 30);
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

  const choose = useCallback(
    (c: Chart) => {
      const ss = new RhythmSession(c, {
        windows: settings.timing,
        countInBars: settings.countInBars,
        audioOffsetMs: settings.audioOffsetMs,
      });
      ss.onJudgement((e) => {
        setNoteStates((prev) => {
          const next = prev.slice();
          next[e.noteIndex] = e.judgement;
          return next;
        });
        setLast(e);
      });
      hits.current = [];
      nextBeat.current = 0;
      finishing.current = false;
      inputManager.setCandidateProvider(null);
      setChart(c);
      setSession(ss);
      setStatus('idle');
      setSongTime(ss.songTime());
      setNoteStates(new Array<Judgement | null>(c.notes.length).fill(null));
      setStrays([]);
      setLast(null);
      setLog(null);
      setFocusBar(undefined);
      setAbortOpen(false);
      setStage('ready');
    },
    [settings.timing, settings.countInBars, settings.audioOffsetMs],
  );

  const begin = useCallback(async () => {
    const ss = sessionRef.current;
    if (!ss || stageRef.current !== 'ready') return;
    await unlockAudio();
    startedAt.current = new Date();
    metronome.stop();
    ss.start();
    inputManager.setCandidateProvider((t) => ss.candidates(t));
    setStage('play');
  }, []);

  const toSelect = useCallback(() => {
    inputManager.setCandidateProvider(null);
    setAbortOpen(false);
    setSession(null);
    setChart(null);
    setLog(null);
    setSongTime(null);
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

  /** 처음부터: 같은 곡으로 새 세션을 만들어 준비 상태로 돌아간다 */
  const restart = useCallback(() => {
    if (chart) choose(chart);
  }, [chart, choose]);

  const finish = useCallback(
    (ss: RhythmSession) => {
      if (finishing.current) return;
      finishing.current = true;
      inputManager.setCandidateProvider(null);
      const built = buildPlayLog({
        snapshot: ss.snapshot(),
        notes: ss.notes,
        hits: hits.current,
        chart: ss.chart,
        inputSource,
        timing: settings.timing,
        profile: settings.profile,
        startedAt: startedAt.current ?? new Date(),
      });
      const saved: PlayLog = { ...built, mode: 'SHEET' };
      savePlayLog(saved);
      setNoteStates(ss.notes.map((n) => n.judgement));
      setLog(saved);
      setSongTime(null);
      setStatus('finished');
      setStage('feedback');
    },
    [inputSource, settings.timing, settings.profile],
  );

  // 매 프레임: Miss 처리·종료 감지·박 클릭 예약·곡 시각 갱신
  const onFrame = useCallback(
    (now: number) => {
      const ss = sessionRef.current;
      if (!ss) return;
      const st = stageRef.current;
      if (st === 'play') {
        ss.tick(now);
        if (ss.currentStatus === 'finished') {
          finish(ss);
          return;
        }
        if (ss.currentStatus !== 'paused') {
          const t = ss.songTime(now);
          const beatsPerBar = ss.chart.beatsPerBar;
          // 박 i의 곡 시각 = −카운트인 + i×박. 카운트인 클릭은 항상, 플레이 중 클릭은 메트로놈 설정
          for (;;) {
            const bt = -ss.countInMs + nextBeat.current * ss.beatMs;
            if (bt > t + CLICK_LOOKAHEAD_MS || bt > ss.chart.durationMs) break;
            if (bt >= t - 50 && (bt < 0 || settings.metronome)) {
              audioEngine.click(now + (bt - t), nextBeat.current % beatsPerBar === 0);
            }
            nextBeat.current += 1;
          }
        }
      }
      setStatus(ss.currentStatus);
      setSongTime(ss.songTime(now));
    },
    [finish, settings.metronome],
  );

  useEffect(() => {
    if (stage !== 'ready' && stage !== 'play') return;
    let raf = 0;
    const loop = (now: number) => {
      onFrame(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stage, onFrame]);

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
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abortOpen, begin, toSelect, openAbort, continueGame]);

  // 피드백 카드 클릭: 같은 카드를 다시 눌러도 스크롤되도록 값을 한 번 비웠다가 넣는다
  const focusBars = useCallback((bars: [number, number]) => {
    setFocusBar(undefined);
    requestAnimationFrame(() => setFocusBar(bars[0]));
  }, []);

  const feedback = useMemo(() => (log && chart ? buildFeedback(log, chart) : []), [log, chart]);
  const summary = useMemo(() => (log ? summarizeByPad(log) : []), [log]);

  if (stage === 'select' || !chart || !session || !model) {
    return (
      <main className="main">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h1>악보 연습</h1>
          <span className="small dim">곡을 고르면 악보 준비 화면으로 갑니다</span>
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
            <h3>악보 연습이란</h3>
            <p className="small dim">
              마디별 격자 악보를 보며 칩니다. 점수와 콤보는 보이지 않고, 칠 때마다 노트 칸이 판정 색으로 바뀝니다.
              끝나면 약한 패드·구간을 짚어 주는 피드백이 나옵니다.
            </p>
            <p className="small dim">
              카운트인 {settings.countInBars}마디 · 메트로놈 {settings.metronome ? '켬' : '끔'} · 입력 {inputSource}{' '}
              <Link to="/setup">세팅에서 바꾸기</Link>
            </p>
            {settings.sensorKind !== 'none' && !calDone && (
              <p className="small dim">
                캘리브레이션이 없어 센서 타격은 판정되지 않습니다. 키보드 타격은 판정됩니다.{' '}
                <Link to="/calibration">캘리브레이션 하기</Link>
              </p>
            )}
            <p className="small faint">Enter 시작 · Esc 중단 확인.</p>
          </div>
        </div>
      </main>
    );
  }

  const totalBars = model.bars.length;
  const pos = songTime === null ? null : positionAt(model, songTime);
  const inSong = pos !== null && pos.bar >= 0;
  // 피드백 단계는 곡이 끝난 상태이므로 마지막 마디로 고정한다
  const curBar = stage === 'feedback' ? totalBars : pos ? Math.min(totalBars, Math.max(0, pos.bar + 1)) : 0;
  // 카운트인 중에도 박 점은 센다 (pos.bar가 음수여도 beat는 마디 안 위치)
  const curBeat = pos && stage !== 'feedback' && status !== 'idle' ? pos.beat : -1;
  const progress = stage === 'feedback' ? 1 : inSong ? Math.min(1, curBar / totalBars) : 0;
  const statusLabel = stage === 'feedback' ? '피드백' : STATUS_LABEL[status];

  return (
    <main className="main">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1>악보 연습</h1>
          <div className="small dim">
            {chart.title} · {chart.bpm} BPM · {totalBars}마디
          </div>
        </div>
        <span className="chip active">{statusLabel}</span>
      </div>

      <div className="sheet-top card" style={{ marginBottom: 12, padding: 12 }}>
        <span className="small" style={{ minWidth: 92 }}>
          {inSong || stage === 'feedback' ? `마디 ${curBar} / ${totalBars}` : `마디 – / ${totalBars}`}
        </span>
        <div className="progress" aria-label="진행">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="sheet-dots" aria-label="현재 박">
          {Array.from({ length: model.beatsPerBar }, (_, i) => (
            <span key={i} className={i === curBeat ? 'on' : ''} />
          ))}
        </div>
        <div className="row">
          <button className="btn-primary" onClick={() => void begin()} disabled={stage !== 'ready'}>
            시작
          </button>
          <button className="btn-ghost" onClick={restart} disabled={stage === 'ready'}>
            처음부터
          </button>
          <button
            className="btn-ghost"
            onClick={stage === 'play' ? (abortOpen ? continueGame : openAbort) : toSelect}
          >
            종료
          </button>
        </div>
      </div>

      <div className="sheet-wrap">
        <SheetGrid
          model={model}
          noteStates={noteStates}
          strayHits={strays}
          songTimeMs={stage === 'feedback' ? null : songTime}
          focusBar={focusBar}
        />
        {stage === 'ready' && (
          <div className="overlay">
            <h2>{chart.title}</h2>
            <p className="dim">
              {DIFF_LABEL[chart.difficulty]} · {chart.bpm} BPM · {totalBars}마디
            </p>
            <button className="btn-primary btn-lg" onClick={() => void begin()}>
              시작 (Enter)
            </button>
            <button className="btn-ghost" onClick={toSelect}>
              곡 선택으로 (Esc)
            </button>
            <p className="small faint">
              쳐 보면 소리만 납니다. 시작하면 {settings.countInBars}마디 카운트인 뒤 악보를 따라갑니다.
            </p>
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

      <div className="sheet-legend" style={{ margin: '8px 0 16px' }}>
        <span>
          <i style={{ opacity: 0.6 }} />
          아직 안 침
        </span>
        <span>
          <i className="perfect" />
          PERFECT
        </span>
        <span>
          <i className="good" />
          GOOD
        </span>
        <span>
          <i className="miss" />
          MISS
        </span>
        <span>
          <i
            style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--miss)', borderColor: 'transparent' }}
          />
          채보 밖 타격
        </span>
      </div>

      {stage !== 'feedback' && (
        <div className="card small dim">
          {last
            ? `마지막 타격: ${PAD_META[last.pad].label} · ${last.deltaMs === null ? '놓침' : `${last.deltaMs >= 0 ? '+' : '-'}${Math.abs(last.deltaMs).toFixed(0)}ms`}`
            : '마지막 타격: –'}
        </div>
      )}

      {stage === 'feedback' && log && (
        <div className="col" style={{ gap: 16 }}>
          <FeedbackCards items={feedback} summary={summary} onFocusBars={focusBars} />
          <div className="row">
            <button className="btn-primary" onClick={restart}>
              같은 곡 다시
            </button>
            <button className="btn-ghost" onClick={toSelect}>
              다른 곡
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
