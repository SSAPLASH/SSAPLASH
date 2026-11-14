// FX 랩(개발 전용, 설계 MODE-002-hit-fx-theme 4-2) — 타격 이펙트 테마 A/B 비교·자동 연주·성능 표시.
// 개발 서버에서만 열린다(App.tsx가 import.meta.env.DEV일 때만 lazy 라우트로 건다). 랩 이벤트는 자체 emitter로 보내
// 판정·코칭·녹화에 섞이지 않는다. 소리를 켜면 audioEngine.trigger로 소리만 직접 낸다(liveStore·텔레메트리 우회).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DrumKit } from '@/components/drum/DrumKit';
import type { FxEngine } from '@/components/fx/fxEngine';
import { createFxEmitter, createLiveFxSource } from '@/components/fx/fxSource';
import { ComboDisplay } from '@/features/play/components/stage/ComboDisplay';
import { CelebrationFx } from '@/features/result/components/CelebrationFx';
import type { Judgement } from '@/domain/play/judgement';
import { KIT_SKINS, KIT_SKIN_LABELS, type KitSkin } from '@/domain/kit/drumKit';
import { HIT_FX_LAB_THEMES, HIT_FX_THEME_LABELS } from '@/domain/hitFx/themes';
import type { FxSource, HitFxTheme } from '@/domain/hitFx/types';
import type { PadId } from '@/domain/kit/pads';
import { audioEngine } from '@/audio/AudioEngine';
import { unlockAudio } from '@/runtime/audioUnlock';
import { LAB_COMBO_DEFAULT, LAB_COMBO_STEP_MS, LAB_JUDGEMENTS, LAB_PATTERNS, combineStats, comboSeqSteps, hitsInWindow, isLabJudgement, isLabPattern, labJudgementFields, type LabJudgementId, type LabPatternId, type LabStats } from './fxLabPatterns';
import './FxLabPage.css';

type Side = 'a' | 'b';
type View = 'ab' | 'single';

const MAX_PARTICLE_CHOICES = [50, 100, 200, 400] as const;
/** 이펙트 재생 속도 선택(이펙트 시계만 느려진다. 소리·판정 시각은 그대로) */
const TIME_SCALE_CHOICES = [1, 0.5, 0.25, 0.1] as const;
/** 성능 표시 갱신 주기(ms). 이 표시용 setState는 타격 경로와 무관하다 */
const STATS_MS = 250;
/** 패턴 시계 간격(ms) */
const TICK_MS = 8;
/** 예산(설계 D10): 이펙트 처리 p95 ≤ 2ms, 동시 파티클 ≤ 200 */
const BUDGET_P95_MS = 2;

export interface FxLabSnapshot {
  a: LabStats | null;
  b: LabStats | null;
  total: LabStats;
}

/** 개발 빌드에서만 window.__fxLab으로 노출되는 측정용 API(headless 브라우저 자동화) */
export interface FxLabApi {
  /** 자동 연주 패턴 선택(시계를 0부터 다시 시작) */
  setPattern(id: LabPatternId): void;
  /** 킷 A/B의 테마 */
  setTheme(side: Side, id: HitFxTheme): void;
  /** 이펙트 재생 속도(0.1~1) */
  setTimeScale(k: number): void;
  /** 이펙트 일시정지 / 해제 */
  setPaused(on: boolean): void;
  /** 멈춘 상태에서 한 프레임(16.7ms) 넘김 */
  stepFrame(): void;
  /** 킷 파티클 상한(50/100/200/400 등 임의 양수) */
  setMaxParticles(n: number): void;
  /** 발광(스프라이트·번개 테두리) 켜기/끄기 */
  setGlow(on: boolean): void;
  /** 모션 줄이기 강제 */
  setReduced(on: boolean): void;
  /** 'ab' 나란히 / 'single' A만 크게 */
  setView(v: View): void;
  /** 판정 선택(없음/perfect/good-early/good-late/stray/mix). 이후 타격에 판정을 붙여 보낸다 */
  setJudgement(id: LabJudgementId): void;
  /** 고정 세기(1~127). null이면 패턴 악센트 */
  setFixedVelocity(v: number | null): void;
  /** 현재 통계. 단일 보기면 b는 null, total은 마운트된 킷의 합 */
  stats(): FxLabSnapshot;
  /** 프레임 통계·버린 수 초기화 */
  resetStats(): void;
  /** 콤보 미리보기 재생. 값 순서(기본 [2,10,50,0], 0 = MISS) */
  playCombo(seq?: readonly number[]): void;
  /** 결과 축하 미리보기 1회 발사 */
  celebrate(): void;
}

declare global {
  interface Window {
    __fxLab?: FxLabApi;
  }
}

const ms = (n: number) => n.toFixed(2);

function StatRow({ name, s }: { name: string; s: LabStats | null }) {
  if (!s)
    return (
      <tr>
        <td>{name}</td>
        <td colSpan={6}>—</td>
      </tr>
    );
  return (
    <tr>
      <td>{name}</td>
      <td>{ms(s.frameMsAvg)}</td>
      <td className={s.frameMsP95 > BUDGET_P95_MS ? 'fxlab-over' : undefined}>{ms(s.frameMsP95)}</td>
      <td className={s.alive > 200 ? 'fxlab-over' : undefined}>{s.alive}</td>
      <td>{s.dropped}</td>
      <td>{s.fps.toFixed(0)}</td>
      <td>{s.running ? '동작' : '정지'}</td>
    </tr>
  );
}

export function FxLabPage() {
  const [view, setView] = useState<View>('ab');
  const [themeA, setThemeA] = useState<HitFxTheme>('auto');
  const [themeB, setThemeB] = useState<HitFxTheme>('electric');
  const [skinA, setSkinA] = useState<KitSkin>('electronic');
  const [skinB, setSkinB] = useState<KitSkin>('electronic');
  const [pattern, setPatternState] = useState<LabPatternId>('off');
  const [fixedOn, setFixedOn] = useState(false);
  const [velocity, setVelocity] = useState(100);
  const [judgeId, setJudgeIdState] = useState<LabJudgementId>('none');
  const [sound, setSound] = useState(false);
  const [manual, setManual] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [glow, setGlow] = useState(true);
  const [maxParticles, setMaxParticlesState] = useState<number>(200);
  const [timeScale, setTimeScaleState] = useState<number>(1);
  const [paused, setPausedState] = useState(false);
  const [snap, setSnap] = useState<FxLabSnapshot | null>(null);

  const engineA = useRef<FxEngine | null>(null);
  const engineB = useRef<FxEngine | null>(null);
  // 결과 축하 미리보기 엔진(통계 합산용)
  const engineC = useRef<FxEngine | null>(null);
  const [comboView, setComboView] = useState<{ combo: number; judgement: Judgement | null; at: number | null }>({ combo: 0, judgement: null, at: null });
  const [comboPlacement, setComboPlacement] = useState<'top' | 'stage'>('top');
  const [celebrateRun, setCelebrateRun] = useState(0);
  const comboTimers = useRef<number[]>([]);
  const comboAt = useRef(0);
  const [emitter] = useState(createFxEmitter);
  const seqRef = useRef(0);

  // 시계·이벤트 경로가 읽는 최신 값(React 렌더와 무관하게 즉시 반영)
  const live = useRef({ pattern: 'off' as LabPatternId, fixedOn: false, velocity: 100, sound: false, manual: true, view: 'ab' as View, judge: 'none' as LabJudgementId });
  useEffect(() => {
    live.current.fixedOn = fixedOn;
    live.current.velocity = velocity;
    live.current.sound = sound;
    live.current.manual = manual;
    live.current.view = view;
  }, [fixedOn, velocity, sound, manual, view]);
  const clock = useRef({ t0: 0, last: 0 });

  const emitHit = useCallback(
    (pad: PadId, accent: number) => {
      const v = live.current.fixedOn ? live.current.velocity : accent;
      const seq = ++seqRef.current;
      emitter.emit({ seq, pad, velocity: v, mode: 'lab', combo: null, noteIndex: null, ...labJudgementFields(live.current.judge, seq) });
      if (live.current.sound) audioEngine.trigger(pad, v);
    },
    [emitter],
  );

  const setJudge = useCallback((id: LabJudgementId) => {
    live.current.judge = id;
    setJudgeIdState(id);
  }, []);

  /** 깨짐 미리보기: 패드 화면에는 MISS가 나오지 않으므로 스네어 위에 파편만 낸다 */
  const previewShatter = useCallback(() => {
    emitter.emit({ seq: ++seqRef.current, pad: 'SNARE', velocity: 0, mode: 'lab', judgement: 'MISS', deltaMs: null, combo: null, noteIndex: null, stray: false });
  }, [emitter]);

  /** 콤보 미리보기: 값 순서대로 일정 간격으로 ComboDisplay에 판정을 넣는다(세션 없이 props만) */
  const playCombo = useCallback((seq: readonly number[] = LAB_COMBO_DEFAULT) => {
    comboTimers.current.forEach((t) => window.clearTimeout(t));
    comboTimers.current = [];
    // 처음부터 보이도록 먼저 비운다(콤보 0·판정 없음 = 숨김)
    setComboView({ combo: 0, judgement: null, at: null });
    comboSeqSteps(seq).forEach((step, i) => {
      comboTimers.current.push(
        window.setTimeout(() => setComboView({ combo: step.combo, judgement: step.judgement, at: ++comboAt.current }), 60 + i * LAB_COMBO_STEP_MS),
      );
    });
  }, []);
  useEffect(
    () => () => {
      comboTimers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );
  const celebrateNow = useCallback(() => setCelebrateRun((n) => n + 1), []);

  const applyPattern = useCallback((id: LabPatternId) => {
    live.current.pattern = id;
    clock.current = { t0: performance.now(), last: -1 };
    setPatternState(id);
  }, []);

  // 패턴 시계: setInterval 하나. 지난 틱 이후 구간의 타격을 한꺼번에 낸다(프레임이 밀려도 개수는 유지)
  useEffect(() => {
    const id = window.setInterval(() => {
      const pat = live.current.pattern;
      if (pat === 'off') return;
      const el = performance.now() - clock.current.t0;
      const hits = hitsInWindow(pat, clock.current.last, el);
      clock.current.last = el;
      for (const h of hits) emitHit(h.pad, h.velocity);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [emitHit]);

  // 수동 입력: liveStore 타격(키보드 등)과 패턴 emitter를 합친 소스 하나. 수동 토글이 꺼지면 liveStore 쪽만 막는다
  const source = useMemo<FxSource>(() => {
    const liveSource = createLiveFxSource('lab');
    return (onEvent) => {
      const off1 = emitter.source(onEvent);
      const off2 = liveSource((e) => {
        if (live.current.manual) onEvent(e);
      });
      return () => {
        off1();
        off2();
      };
    };
  }, [emitter]);

  const getSnap = useCallback((): FxLabSnapshot => {
    const a = engineA.current?.stats() ?? null;
    const b = live.current.view === 'ab' ? (engineB.current?.stats() ?? null) : null;
    // 축하 미리보기 캔버스가 떠 있으면 합계에 함께 센다
    const c = engineC.current?.stats() ?? null;
    return { a, b, total: combineStats([a, b, c].filter((x): x is LabStats => x !== null)) };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setSnap(getSnap()), STATS_MS);
    return () => window.clearInterval(id);
  }, [getSnap]);

  // 재생 속도·일시정지를 두 킷 엔진에 반영한다(킷 B는 단일 보기에서 사라졌다 다시 생길 수 있어 보기가 바뀔 때도 다시 건다)
  useEffect(() => {
    for (const r of [engineA, engineB]) {
      r.current?.setTimeScale(timeScale);
      r.current?.setPaused(paused);
    }
  }, [timeScale, paused, view]);

  const stepFrame = useCallback(() => {
    engineA.current?.stepFrame();
    engineB.current?.stepFrame();
  }, []);

  // 숫자 키 1~6: 킷 A 테마
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      const next = Number.isInteger(n) ? HIT_FX_LAB_THEMES[n - 1] : undefined;
      if (next) setThemeA(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 자동화용 API(개발 빌드 전용)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const both = (fn: (e: FxEngine) => void) => {
      if (engineA.current) fn(engineA.current);
      if (engineB.current) fn(engineB.current);
    };
    const api: FxLabApi = {
      setPattern: (id) => {
        if (isLabPattern(id)) applyPattern(id);
      },
      setJudgement: (id) => {
        if (isLabJudgement(id)) setJudge(id);
      },
      setTheme: (side, id) => {
        (side === 'a' ? setThemeA : setThemeB)(id);
        (side === 'a' ? engineA : engineB).current?.setTheme(id);
      },
      setTimeScale: (k) => setTimeScaleState(k),
      setPaused: (on) => setPausedState(on),
      stepFrame,
      setMaxParticles: (n) => {
        setMaxParticlesState(n);
        both((e) => e.setMaxParticles(n));
      },
      setGlow: (on) => {
        setGlow(on);
        both((e) => e.setGlow(on));
      },
      setReduced: (on) => {
        setReduced(on);
        both((e) => e.setReduced(on));
      },
      setView: (v) => {
        live.current.view = v;
        setView(v);
      },
      setFixedVelocity: (v) => {
        live.current.fixedOn = v !== null;
        if (v !== null) live.current.velocity = v;
        setFixedOn(v !== null);
        if (v !== null) setVelocity(v);
      },
      stats: getSnap,
      resetStats: () => {
        both((e) => e.resetStats());
        engineC.current?.resetStats();
      },
      playCombo,
      celebrate: celebrateNow,
    };
    window.__fxLab = api;
    return () => {
      delete window.__fxLab;
    };
  }, [applyPattern, getSnap, setJudge, playCombo, celebrateNow, stepFrame]);

  const fxOptions = { reduced: reduced ? true : undefined, maxParticles, glow };

  const onPadDown = (pad: PadId) => {
    if (live.current.manual) emitHit(pad, live.current.velocity);
  };

  const kit = (side: Side) => {
    const isA = side === 'a';
    const theme = isA ? themeA : themeB;
    const skin = isA ? skinA : skinB;
    return (
      <section className="fxlab-kit" aria-label={`킷 ${side.toUpperCase()}`}>
        <div className="fxlab-kit-head">
          <strong>{side.toUpperCase()}</strong>
          <select value={theme} aria-label={`${side.toUpperCase()} 테마`} onChange={(e) => (isA ? setThemeA : setThemeB)(e.target.value as HitFxTheme)}>
            {HIT_FX_LAB_THEMES.map((t, i) => (
              <option key={t} value={t}>
                {isA ? `${i + 1} · ` : ''}
                {HIT_FX_THEME_LABELS[t]}
              </option>
            ))}
          </select>
          <select value={skin} aria-label={`${side.toUpperCase()} 스킨`} onChange={(e) => (isA ? setSkinA : setSkinB)(e.target.value as KitSkin)}>
            {KIT_SKINS.map((s) => (
              <option key={s} value={s}>
                {KIT_SKIN_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <DrumKit
          effects
          fitWidth
          scale={view === 'single' ? 1.25 : 1}
          skin={skin}
          fxTheme={theme}
          fxSource={source}
          fxEngineRef={isA ? engineA : engineB}
          fxOptions={fxOptions}
          onPadDown={onPadDown}
        />
      </section>
    );
  };

  return (
    <main className="fxlab">
      <h1>FX 랩 (개발 전용)</h1>
      <p className="fxlab-note">같은 이벤트를 두 킷에 동시에 보낸다. 숫자 키 1~6은 A 테마 선택. 패턴·세기·소리는 판정·기록에 들어가지 않는다. 판정 선택은 패드 이펙트의 판정 배율·링·헛침 회색 퍼짐을 본다(하이웨이·악보는 실제 화면에서).</p>

      <div className="fxlab-controls">
        <div className="fxlab-group">
          보기
          <div className="fxlab-row">
            <button type="button" aria-pressed={view === 'ab'} onClick={() => setView('ab')}>
              A/B 나란히
            </button>
            <button type="button" aria-pressed={view === 'single'} onClick={() => setView('single')}>
              단일(A 크게)
            </button>
          </div>
        </div>
        <div className="fxlab-group">
          자동 연주 패턴
          <div className="fxlab-row">
            {LAB_PATTERNS.map((p) => (
              <button key={p.id} type="button" aria-pressed={pattern === p.id} onClick={() => applyPattern(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="fxlab-group">
          재생 속도
          <div className="fxlab-row">
            {TIME_SCALE_CHOICES.map((k) => (
              <button key={k} type="button" aria-pressed={timeScale === k} onClick={() => setTimeScaleState(k)}>
                {k}배
              </button>
            ))}
            <button type="button" aria-pressed={paused} onClick={() => setPausedState((p) => !p)}>
              일시정지
            </button>
            <button type="button" disabled={!paused} onClick={stepFrame}>
              한 프레임 넘김
            </button>
          </div>
        </div>
        <div className="fxlab-group">
          판정
          <div className="fxlab-row">
            {LAB_JUDGEMENTS.map((j) => (
              <button key={j.id} type="button" aria-pressed={judgeId === j.id} onClick={() => setJudge(j.id)}>
                {j.label}
              </button>
            ))}
            <button type="button" onClick={previewShatter}>
              깨짐 미리보기
            </button>
          </div>
        </div>
        <div className="fxlab-group">
          콤보·결과 연출
          <div className="fxlab-row">
            <button type="button" onClick={() => playCombo()}>
              콤보 미리보기
            </button>
            <label>
              위치
              <select value={comboPlacement} aria-label="콤보 위치" onChange={(e) => setComboPlacement(e.target.value as 'top' | 'stage')}>
                <option value="top">A 상단 중앙 상시</option>
                <option value="stage">B 단계 때만 가운데</option>
              </select>
            </label>
            <button type="button" onClick={celebrateNow}>
              축하 미리보기
            </button>
          </div>
        </div>
        <div className="fxlab-group">
          세기
          <div className="fxlab-row">
            <label>
              <input type="checkbox" checked={fixedOn} onChange={(e) => setFixedOn(e.target.checked)} />
              고정
            </label>
            <input type="range" min={1} max={127} value={velocity} onChange={(e) => setVelocity(Number(e.target.value))} aria-label="고정 세기" />
            <span>{fixedOn ? velocity : '악센트'}</span>
          </div>
        </div>
        <div className="fxlab-group">
          입력·소리
          <div className="fxlab-row">
            <label>
              <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
              수동 입력(키보드·터치)
            </label>
            <label>
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  setSound(e.target.checked);
                  if (e.target.checked) void unlockAudio();
                }}
              />
              소리
            </label>
          </div>
        </div>
        <div className="fxlab-group">
          스파이크
          <div className="fxlab-row">
            <label>
              파티클 상한
              <select value={maxParticles} onChange={(e) => setMaxParticlesState(Number(e.target.value))}>
                {MAX_PARTICLE_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" checked={!glow} onChange={(e) => setGlow(!e.target.checked)} />
              발광 끄기
            </label>
            <label>
              <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
              모션 줄이기 강제
            </label>
            <button type="button" onClick={() => [engineA, engineB].forEach((r) => r.current?.resetStats())}>
              통계 초기화
            </button>
          </div>
        </div>
      </div>

      <div className="fxlab-kits">
        {kit('a')}
        {view === 'ab' && kit('b')}
      </div>

      <div className="fxlab-previews">
        <section className="fxlab-combo-stage" aria-label="콤보 미리보기">
          <ComboDisplay combo={comboView.combo} judgement={comboView.judgement} at={comboView.at} placement={comboPlacement} />
        </section>
        <section className="fxlab-celebrate-card" aria-label="축하 미리보기">
          <span className="fxlab-celebrate-text">최고 기록 갱신 · 이전 1,200,000 → 현재 1,310,000</span>
          {celebrateRun > 0 && <CelebrationFx key={celebrateRun} engineRef={engineC} reduced={reduced ? true : undefined} />}
        </section>
      </div>

      <table className="fxlab-stats" aria-label="성능">
        <thead>
          <tr>
            <th />
            <th>평균 ms</th>
            <th>p95 ms</th>
            <th>파티클</th>
            <th>버림</th>
            <th>FPS</th>
            <th>루프</th>
          </tr>
        </thead>
        <tbody>
          <StatRow name="A" s={snap?.a ?? null} />
          <StatRow name="B" s={snap?.b ?? null} />
          <StatRow name="합계" s={snap?.total ?? null} />
        </tbody>
      </table>
      <p className="fxlab-note">p95 ≤ {BUDGET_P95_MS}ms, 파티클 ≤ 200이 예산. 넘으면 주황으로 표시한다. 합계의 ms는 두 킷의 합이다.</p>
    </main>
  );
}
