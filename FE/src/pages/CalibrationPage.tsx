// 캘리브레이션 (PLAY-008, 설계 4-1 v0.7). 패드마다 중심 자세(앵커)를 잡아 프로필을 만든다.
// 세션(CalibrationSession)은 자세·타격만 받고, 이 페이지는 단계 전환·키 조작·표시·저장을 맡는다.
// 센서 타격만 세션에 넣고 키보드 매핑 타격은 무시한다(U10). 저장 전까지 전역 프로필은 손대지 않는다.
// 화면 구조는 Claude Design UI로 교체 예정이라 최소로 둔다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KitCanvas } from '@/components/KitCanvas';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { PAD_META, STICK_PADS, type PadId } from '@/domain/pads';
import type { Pose } from '@/domain/events';
import { profileWarnings, resolvePad, type CalibrationWarning, type PadResolution } from '@/domain/calibration';
import { CalibrationSession, type CalibrationSnapshot } from '@/engine/CalibrationSession';
import { audioEngine } from '@/audio/AudioEngine';
import { inputManager } from '@/app/sources';
import { resolveOptions, sensorRegistry } from '@/app/sensorRegistry';
import { bindSensorSurface, setSoundOnHit } from '@/app/bootstrap';

type Stage = 'ready' | 'capture' | 'confirm';

/** 캡처에 쓰는 스틱. 0단계는 스틱 0 고정(U14). 포인터는 양쪽이 같다 */
const CAPTURE_STICK = 0;
const CONFIRM_VELOCITY = 0.8;

const warningText = (w: CalibrationWarning): string => {
  const names = w.pads.map((p) => PAD_META[p].label).join('·');
  if (w.kind === 'spread') return `${names}: 손이 흔들렸습니다 (${w.value!.toFixed(1)}°)`;
  if (w.kind === 'close') return `${names}가 너무 가깝습니다 (${w.value!.toFixed(1)}°)`;
  return `미완성: ${names}`;
};

export function CalibrationPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  const activeSensor = useLive((s) => s.activeSensor);
  const pose = useLive((s) => s.pose);
  const sourceState = useLive((s) => s.sourceState);
  const sourceMessage = useLive((s) => s.sourceMessage);

  const [stage, setStage] = useState<Stage>('ready');
  const [snap, setSnap] = useState<CalibrationSnapshot | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [lastTest, setLastTest] = useState<PadResolution | null>(null);
  const [testCount, setTestCount] = useState(0);
  const [saved, setSaved] = useState(false);

  const sessionRef = useRef<CalibrationSession | null>(null);
  const stageRef = useRef<Stage>('ready');
  const exitRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const flashes = useRef(new Map<PadId, number>());
  const rafRef = useRef<number | null>(null);
  const knownAnchors = useRef(new Set<PadId>());

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  useEffect(() => {
    exitRef.current = exitOpen;
  }, [exitOpen]);

  // 진입: 키보드 매핑 타격을 울리지 않게(U10), 채보 후보 해제, 자세 스트림 켬. 이탈: 복구
  useEffect(() => {
    setSoundOnHit(false);
    inputManager.setCandidateProvider(null);
    inputManager.setPoseStream(true);
    return () => {
      setSoundOnHit(true);
      bindSensorSurface(null);
      unsubRef.current?.();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const testHit = useCallback((p: Pose, velocity: number) => {
    const ss = sessionRef.current;
    if (!ss) return;
    const r = resolvePad(ss.build(), p);
    setLastTest(r);
    setTestCount((c) => c + 1);
    if (r?.inside) {
      audioEngine.trigger(r.pad, velocity);
      flashes.current.set(r.pad, performance.now());
    }
  }, []);

  // 자세: 캡처 단계·팝업 닫힘·캡처 스틱만 세션에 넣는다
  useEffect(() => {
    return inputManager.onPose((stickId, p) => {
      if (stickId !== CAPTURE_STICK || stageRef.current !== 'capture' || exitRef.current) return;
      sessionRef.current?.onPose(p, performance.now());
    });
  }, []);

  // 타격: 센서 타격만. 캡처 → 세션, 확인 → 테스트 타격
  useEffect(() => {
    return inputManager.onHit((hit) => {
      if (hit.source === 'keyboard' || exitRef.current) return;
      if (stageRef.current === 'capture') sessionRef.current?.onHit(hit.pose);
      else if (stageRef.current === 'confirm') testHit(hit.pose, hit.velocity);
    });
  }, [testHit]);

  /** 세션 스냅샷 → React 상태. 60Hz 자세를 rAF 한 번에 한 번만 반영한다 */
  const attach = useCallback((ss: CalibrationSession) => {
    unsubRef.current?.();
    sessionRef.current = ss;
    knownAnchors.current = new Set(Object.keys(ss.snapshot().anchors) as PadId[]);
    unsubRef.current = ss.subscribe((s) => {
      // 새로 확정된 앵커: 소리 한 번 + 플래시
      for (const pad of Object.keys(s.anchors) as PadId[]) {
        if (!knownAnchors.current.has(pad)) {
          audioEngine.trigger(pad, CONFIRM_VELOCITY);
          flashes.current.set(pad, performance.now());
        }
      }
      knownAnchors.current = new Set(Object.keys(s.anchors) as PadId[]);
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const cur = ss.snapshot();
        setSnap(cur);
        if (cur.finished && stageRef.current === 'capture') setStage('confirm');
      });
    });
  }, []);

  const sessionOptions = () => ({
    mode: settings.calibrationMode,
    holdMs: settings.holdMs,
    maxRadiusDeg: settings.tuning.maxRadiusDeg,
    radiusFactor: settings.tuning.radiusFactor,
    source: settings.sensorKind,
  });

  const startNew = () => {
    inputManager.resetPose();
    attach(new CalibrationSession(STICK_PADS, sessionOptions()));
    setSaved(false);
    setLastTest(null);
    setStage('capture');
  };
  const startPartial = () => {
    attach(new CalibrationSession(STICK_PADS, sessionOptions(), settings.profile));
    setSaved(false);
    setLastTest(null);
    setStage('confirm');
  };
  const confirmNow = () => sessionRef.current?.onHit(useLive.getState().pose[CAPTURE_STICK]);
  const skip = () => sessionRef.current?.skip();
  const backspace = () => {
    const ss = sessionRef.current;
    if (!ss) return;
    const i = ss.snapshot().index;
    if (i > 0) ss.redo(STICK_PADS[i - 1]);
  };
  const redoPad = (pad: PadId) => {
    sessionRef.current?.redo(pad, true);
    setSaved(false);
    setStage('capture');
  };
  const restartAll = () => {
    sessionRef.current?.restart();
    setSaved(false);
    setLastTest(null);
    setStage('capture');
  };
  const save = () => {
    const ss = sessionRef.current;
    if (!ss) return;
    settings.setProfile(ss.build());
    setSaved(true);
  };
  const exit = () => navigate('/setup');
  const requestExit = () => {
    if (stageRef.current === 'ready') exit();
    else setExitOpen(true);
  };

  // 키 조작 (설계 4-1 표). 팝업 중에는 Enter·Esc = 계속.
  // 핸들러는 렌더마다 바뀌므로 ref로 읽고 리스너는 한 번만 단다
  const actions = { startNew, confirmNow, backspace, skip, requestExit, testHit, sensorNone: settings.sensorKind === 'none' };
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const a = actionsRef.current;
      if (a.sensorNone) return;
      const st = stageRef.current;
      if (exitRef.current) {
        if (e.code === 'Enter' || e.code === 'Escape') {
          setExitOpen(false);
          e.preventDefault();
        }
        return;
      }
      switch (e.code) {
        case 'Enter':
          if (st === 'ready') a.startNew();
          else if (st === 'capture') a.confirmNow();
          else a.testHit(useLive.getState().pose[CAPTURE_STICK], CONFIRM_VELOCITY);
          break;
        case 'Backspace':
          if (st === 'capture') a.backspace();
          break;
        case 'Tab':
          if (st === 'capture') a.skip();
          break;
        case 'Escape':
          a.requestExit();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- 센서 없음 ----
  if (settings.sensorKind === 'none') {
    // 전환 제안은 등록된 소스 중 이 브라우저에서 쓸 수 있는 첫 번째(등록 순서)
    const fallbackSensor = sensorRegistry.list().find((d) => d.availability().ok);
    return (
      <main className="main">
        <h1>캘리브레이션</h1>
        <div className="card col">
          <p className="notice">키보드 입력은 캘리브레이션이 필요 없습니다. 센서(또는 포인터 모의 IMU)를 켜면 패드 자세를 잡을 수 있습니다.</p>
          <div className="row">
            {fallbackSensor && (
              <button className="btn-primary" onClick={() => settings.setSensorKind(fallbackSensor.id)}>
                {fallbackSensor.label}로 전환
              </button>
            )}
            <Link to="/setup" className="btn-ghost">
              세팅으로
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const modeLabel = settings.calibrationMode === 'hold' ? `홀딩 ${(settings.holdMs / 1000).toFixed(1)}초` : '2타';
  const sensorDesc = sensorRegistry.get(settings.sensorKind);
  const sensorLabel = sensorDesc?.label ?? settings.sensorKind;
  const connNote = sensorDesc?.usageGuide
    ? sensorDesc.usageGuide(resolveOptions(sensorDesc, settings.sensorOptions[settings.sensorKind]))
    : sourceState === 'error'
        ? `오류: ${sourceMessage ?? '알 수 없음'}`
        : sourceState === 'connected'
          ? '연결됨'
          : sourceState === 'connecting'
            ? '연결 중…'
            : '연결 안 됨 — 세팅에서 연결하세요.';
  const current = snap?.current ?? null;
  const warnings = stage === 'confirm' && snap ? profileWarnings(snap.anchors, STICK_PADS) : [];
  const shownAnchors = stage === 'ready' ? settings.profile?.anchors : snap?.anchors;

  let guide: string;
  if (stage === 'ready') guide = `${sensorLabel} · ${modeLabel} · 반경 상한 ${settings.tuning.maxRadiusDeg}° (변경은 세팅에서). ${connNote}`;
  else if (stage === 'capture' && current) {
    const n = STICK_PADS.indexOf(current) + 1;
    guide =
      settings.calibrationMode === 'hold'
        ? `${n} / ${STICK_PADS.length} · ${PAD_META[current].label} 패드 위에 스틱을 멈추세요`
        : `${n} / ${STICK_PADS.length} · ${PAD_META[current].label} 패드를 2번 치세요 ${snap?.hitCount ?? 0} / 2`;
  } else guide = '아무 패드나 쳐 보세요. 저장 전까지 전역 판정은 바뀌지 않습니다.';

  return (
    <main className="main wide">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1>캘리브레이션</h1>
        <span className="small dim">{stage === 'ready' ? '준비' : stage === 'capture' ? '캡처' : '확인'}</span>
      </div>
      <p className={stage === 'capture' ? 'cal-instruction' : 'small dim'} style={{ marginBottom: 12 }} data-guide>
        {guide}
      </p>

      <div className="cal-layout">
        <div className="card col" style={{ position: 'relative' }}>
          <KitCanvas
            layout={settings.kitLayout}
            anchors={shownAnchors}
            highlightPad={stage === 'capture' ? current : null}
            dimOthers={stage === 'capture'}
            previewPad={stage === 'confirm' ? (lastTest?.pad ?? null) : null}
            flashes={flashes}
            poses={pose}
            showPoses={activeSensor !== 'none'}
            surfaceRef={bindSensorSurface}
          />
          {stage === 'ready' && (
            <div className="overlay">
              <h2>기준 자세를 잡습니다</h2>
              <p className="dim">스틱을 편한 기본 자세에 두고 시작하세요. 그 자세가 0°가 됩니다.</p>
              <button className="btn-primary btn-lg" onClick={startNew}>
                기준 자세 잡기 (Enter)
              </button>
              {settings.profile && (
                <button className="btn-ghost" onClick={startPartial}>
                  일부 패드만 다시
                </button>
              )}
              {settings.profile && (
                <p className="small faint">
                  저장된 프로필: {settings.profile.name} · {new Date(settings.profile.createdAt).toLocaleString('ko-KR')}
                </p>
              )}
            </div>
          )}
          {exitOpen && (
            <div className="overlay" role="dialog" aria-label="나가기 확인">
              <h2>캘리브레이션을 나갈까요?</h2>
              <p className="dim">저장하지 않은 앵커는 사라집니다.</p>
              <div className="row">
                <button className="btn-primary" onClick={() => setExitOpen(false)}>
                  계속 (Enter)
                </button>
                <button className="btn-danger" onClick={exit}>
                  나가기
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="col">
          {stage === 'capture' && snap && (
            <div className="card col">
              <div className="progress" aria-label="진행">
                <div style={{ width: `${Math.round(snap.progress * 100)}%` }} />
              </div>
              <div className="row" style={{ gap: 16 }}>
                <div className="stat">
                  <span className="v">{snap.spread.toFixed(1)}°</span>
                  <span className="k">안정도 (최근 300ms 퍼짐, 3° 이하면 홀딩)</span>
                </div>
                <div className="stat">
                  <span className="v" style={{ fontSize: 20 }}>
                    {snap.phase === 'holding' ? '홀딩 중' : '조준'}
                  </span>
                  <span className="k">상태</span>
                </div>
              </div>
              <div className="row">
                <button className="btn-ghost" onClick={confirmNow}>
                  지금 위치로 확정 (Enter)
                </button>
                <button className="btn-ghost" onClick={backspace} disabled={snap.index === 0}>
                  직전 다시 (Backspace)
                </button>
                <button className="btn-ghost" onClick={skip}>
                  건너뛰기 (Tab)
                </button>
                <button className="btn-ghost" onClick={requestExit}>
                  나가기 (Esc)
                </button>
              </div>
            </div>
          )}

          {stage === 'confirm' && snap && (
            <div className="card col">
              <h3>테스트 타격</h3>
              {lastTest ? (
                <div className="row" style={{ gap: 16 }} data-test-hit={testCount}>
                  <div className="stat">
                    <span className="v" style={{ color: lastTest.inside ? PAD_META[lastTest.pad].color : 'inherit' }}>
                      {lastTest.inside ? PAD_META[lastTest.pad].label : '판정 없음'}
                    </span>
                    <span className="k">판정</span>
                  </div>
                  <div className="stat">
                    <span className="v" style={{ fontSize: 20 }}>
                      {PAD_META[lastTest.pad].label} {lastTest.distanceDeg.toFixed(1)}°
                    </span>
                    <span className="k">{lastTest.inside ? '앵커 안' : '가장 가까운 패드 (앵커 밖)'}</span>
                  </div>
                </div>
              ) : (
                <p className="small faint">아직 테스트 타격이 없습니다. 패드 위에서 치거나 Enter를 누르세요.</p>
              )}
              {warnings.length > 0 && (
                <ul className="col" style={{ gap: 6, listStyle: 'none' }} data-warnings>
                  {warnings.map((w, i) => (
                    <li key={i} className={`notice${w.kind === 'missing' ? '' : ' error'}`}>
                      {warningText(w)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="row">
                <button className="btn-primary" onClick={save}>
                  저장
                </button>
                <button className="btn-ghost" onClick={restartAll}>
                  처음부터
                </button>
                <button className="btn-ghost" onClick={requestExit}>
                  나가기 (Esc)
                </button>
              </div>
              {saved && (
                <p className="notice" data-saved>
                  저장됐습니다. 이제 센서 타격이 이 프로필로 판정됩니다. <Link to="/free">자유 연주</Link> · <Link to="/">홈</Link>
                </p>
              )}
            </div>
          )}

          {stage !== 'ready' && snap && (
            <div className="card col">
              <h3>패드</h3>
              <div className="cal-steps">
                {STICK_PADS.map((pad) => {
                  const a = snap.anchors[pad];
                  const isCur = stage === 'capture' && current === pad;
                  const passed = STICK_PADS.indexOf(pad) < snap.index || snap.finished;
                  return (
                    <div key={pad} className={`cal-step${isCur ? ' current' : ''}${a ? ' done' : ''}`} data-pad={pad}>
                      <span className="swatch" style={{ background: PAD_META[pad].color }} />
                      <span>
                        {PAD_META[pad].label}
                        <span className="meta">
                          {' '}
                          {a ? `✓ 퍼짐 ${a.spread.toFixed(1)}° · 반경 ${a.radius.toFixed(0)}°` : isCur ? '현재' : passed ? '건너뜀' : ''}
                        </span>
                      </span>
                      {stage === 'confirm' ? (
                        <button className="btn-ghost small" onClick={() => redoPad(pad)}>
                          다시
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stage === 'ready' && (
            <div className="card col">
              <h3>현재 설정</h3>
              <table className="plain">
                <tbody>
                  <tr>
                    <td className="dim">센서</td>
                    <td>{sensorLabel}</td>
                  </tr>
                  <tr>
                    <td className="dim">캡처 방식</td>
                    <td>{modeLabel}</td>
                  </tr>
                  <tr>
                    <td className="dim">판정 반경 상한</td>
                    <td>{settings.tuning.maxRadiusDeg}°</td>
                  </tr>
                  <tr>
                    <td className="dim">대상 패드</td>
                    <td>{STICK_PADS.map((p) => PAD_META[p].label).join(' → ')} (킥 제외)</td>
                  </tr>
                </tbody>
              </table>
              <p className="small faint">
                Enter 확정 · Backspace 직전 다시 · Tab 건너뛰기 · Esc 나가기. <Link to="/setup">세팅에서 방식 변경</Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
