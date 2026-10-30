// 통합 설정 페이지(/setup). 단계 카드 3장(스틱 연결·시작 위치 보정·프리셋) → 드럼 배치 절 → 접힌 고급 설정 → 하단 저장 바.
// 연주 준비에서 왔으면(returnTo) 위에 복귀 띠를 고정하고, 저장하지 않은 변경이 있으면 나가기 전에 확인한다.
// 단계 판정·문구는 domain/setupSteps, 펼침 규칙은 domain/setupExpand, 저장은 presetStore, 보정은 ReferenceCapture가 맡고
// 이 페이지는 조립과 표시만 한다. 판정은 배치(kitLayout)에서 유도되므로 편집 중 배치가 곧 판정이다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { KitCanvas } from '@/components/KitCanvas';
import { SensorOptionsPanel } from '@/components/SensorOptionsPanel';
import { useHitFx } from '@/components/useHitFx';
import { PresetNameDialog } from '@/components/setup/PresetNameDialog';
import { ReturnBanner } from '@/components/setup/ReturnBanner';
import { StepCard } from '@/components/setup/StepCard';
import { StickCard } from '@/components/setup/StickCard';
import { UnsavedLeaveDialog } from '@/components/setup/UnsavedLeaveDialog';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { selectDirty, usePresets } from '@/store/presetStore';
import { LANE_PADS, PAD_META, type PadId } from '@/domain/pads';
import type { HitFx } from '@/domain/events';
import { KEY_MAP } from '@/domain/keyMap';
import { layoutToProfile } from '@/domain/kitJudge';
import { KIT_LAYOUT_PRESET_LABELS, type KitLayoutPresetId } from '@/domain/kitLayout';
import type { PresetErrorCode } from '@/domain/preset';
import type { PadTableStatus, YawDriftStatus } from '@/domain/calibration';
import { sanitizeReturnTo } from '@/domain/auth';
import { readiness } from '@/domain/readiness';
import {
  SETUP_BAR_DIRTY_TEXT,
  SETUP_BAR_NO_PRESET_TEXT,
  dongleLine,
  returnBannerText,
  returnButtonText,
  returnTargetName,
  setupBarCleanText,
  setupSteps,
  unsavedLeaveText,
  type SetupDongleState,
  type SetupStepId,
} from '@/domain/setupSteps';
import { collapse, initialOpen, isExpanded, openByUser, openOnFirstNeededChange } from '@/domain/setupExpand';
import { DRIFT_COOLDOWN_MS, DRIFT_MIN_DEG, TUNING_RANGES } from '@/domain/tuning';
import { audioEngine } from '@/audio/AudioEngine';
import { SOUND_SET_LABELS, type SoundSetId } from '@/audio/soundSets';
import { ReferenceCapture, type ReferenceSnapshot } from '@/engine/ReferenceCapture';
import { sensorRegistry } from '@/app/sensorRegistry';
import { bindSensorSurface, connectSensor, previewHit, setSoundOnHit } from '@/app/bootstrap';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/app/sources';

const PRESET_IDS: KitLayoutPresetId[] = ['basic', 'wide', 'tight'];
const VELOCITY_CHOICES: { v: 64 | 96 | 120; label: string }[] = [
  { v: 64, label: '약' },
  { v: 96, label: '보통' },
  { v: 120, label: '강' },
];

const NO_SENSOR = { id: 'none', label: '키보드만', description: '키 하나가 패드 하나. 보정 없이 바로 플레이' };

const ERROR_TEXT: Record<PresetErrorCode, string> = {
  NAME_DUPLICATE: '같은 이름의 프리셋이 있습니다',
  LIMIT_EXCEEDED: '프리셋은 10개까지 저장할 수 있습니다',
  CONFLICT: '동시에 변경되어 저장하지 못했습니다. 다시 시도해 주세요',
  NOT_FOUND: '프리셋을 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요',
  NETWORK: '저장하지 못했습니다. 다시 시도해 주세요',
};

const STEP_DOM_ID: Record<SetupStepId, string> = {
  stick: 'step-stick',
  calibration: 'step-calibration',
  preset: 'step-preset',
};

/** 스틱별 방위각 보정 문구. 보일 게 없으면 null. 쿨다운 경과는 1초 tick 리렌더로 갱신된다 */
function yawDriftText(drift: [YawDriftStatus | null, YawDriftStatus | null], connected: [boolean, boolean]): string | null {
  const names = ['왼손', '오른손'];
  const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`;
  const applied: string[] = [];
  let unconfirmed = false;
  let pending: number | null = null;
  drift.forEach((st, i) => {
    if (!st || !connected[i]) return;
    if (st.appliedDeg !== 0) {
      applied.push(`${names[i]} ${fmt(st.appliedDeg)}`);
      if (st.acked === false) unconfirmed = true;
    }
    const cooling = st.lastSentAt !== null && performance.now() - st.lastSentAt < DRIFT_COOLDOWN_MS;
    if (pending === null && st.lastErrorDeg !== null && Math.abs(st.lastErrorDeg) >= DRIFT_MIN_DEG && cooling) pending = st.lastErrorDeg;
  });
  const parts: string[] = [];
  if (applied.length) parts.push(`방위각 보정 ${applied.join(' · ')}${unconfirmed ? ' (미확인)' : ''}`);
  if (pending !== null) parts.push(`방위각 드리프트 감지(${Math.round(pending)}°) · 잠시 뒤 보정`);
  return parts.length ? parts.join(' / ') : null;
}

/** 스틱에 보낸 패드 표의 적용 상태 문구. 500ms 확인 창이 지났는지는 1초 tick 리렌더로 갱신된다 */
function padTableText(t: PadTableStatus): string {
  if (t.acked !== null) return t.acked === t.sent ? `스틱에 패드 ${t.sent}개 적용됨` : `스틱 적용 ${t.acked}개 / 전송 ${t.sent}개`;
  if (performance.now() - t.at > 500) return `스틱 적용 확인 없음(${t.sent}개 전송)`;
  return '스틱에 패드 표 전송 중…';
}

/** 이름 창을 연 이유: leave = 미저장 이탈 확인에서 [저장하고 나가기], save = 일반 저장(③·하단 바) */
type NamePurpose = 'leave' | 'save';

export function SetupPage() {
  const s = useSettings();
  const presets = usePresets();
  const connected = useLive((l) => l.connected);
  const battery = useLive((l) => l.battery);
  const pose = useLive((l) => l.pose);
  const lastHit = useLive((l) => l.lastHit);
  const sourceState = useLive((l) => l.sourceState);
  const sourceMessage = useLive((l) => l.sourceMessage);
  const dongle = useLive((l) => l.dongle);
  const padTable = useLive((l) => l.padTable);
  const yawDrift = useLive((l) => l.yawDrift);
  const referenceSetAt = useLive((l) => l.referenceSetAt);
  const referenceStale = useLive((l) => l.referenceStale);
  const soundSetState = useLive((l) => l.soundSetState);
  const soundSetMissing = useLive((l) => l.soundSetMissing);
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { returnTo?: string; returnLabel?: string } | null;
  const returnTo = navState?.returnTo ? sanitizeReturnTo(navState.returnTo) : null;
  const returnLabel = typeof navState?.returnLabel === 'string' ? navState.returnLabel : undefined;

  // 1초마다 갱신하는 현재 시각. 리렌더 tick이자 "오늘 HH:MM" 판단 기준이다
  const [now, setNow] = useState(() => Date.now());
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const sensorMode = s.sensorKind !== 'none';
  const anyConnected = connected[0] || connected[1];
  const yawDriftLine = sensorMode ? yawDriftText(yawDrift, connected) : null;
  const dirty = selectDirty(s, presets);
  const activePreset = presets.items.find((p) => p.id === s.activePresetId) ?? null;
  const saving = presets.status === 'saving';

  // 진입: 프리셋 목록 읽기, 센서 타격이 바로 울리게
  useEffect(() => {
    void usePresets.getState().refresh();
    setSoundOnHit(true);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // 판정 원은 배치에서 유도한 프로필로 그린다(판정과 같은 규칙)
  const anchors = useMemo(
    () =>
      layoutToProfile(s.kitLayout, s.tuning.angleRange, { maxRadiusDeg: s.tuning.maxRadiusDeg, radiusFactor: s.tuning.radiusFactor }).anchors,
    [s.kitLayout, s.tuning.angleRange, s.tuning.maxRadiusDeg, s.tuning.radiusFactor],
  );

  const lat = audioEngine.latency();

  // 타격 이펙트. 톡 치기·키보드·센서 타격 모두 live의 hitSeq로 들어온다
  const hits = useRef(new Map<PadId, HitFx>());
  useHitFx(hits);
  const testPad = (pad: PadId) => {
    void previewHit(pad, s.testVelocity);
  };

  // ---- 단계 판정(설정 화면에선 "이 세션에서 보정했는가"를 묻는다: firstSetupDone 대신 referenceSetAt) ----
  const readinessInput = {
    sensorKind: s.sensorKind,
    connected,
    firstSetupDone: referenceSetAt !== null,
    activePresetId: s.activePresetId,
  };
  const { ready, missing } = readiness(readinessInput);
  // 동글 상태는 동글 소스(Web Serial)일 때만. 포트가 열렸는데 LINK 전이면 waiting(예전 동글 펌웨어 포함)
  const dongleState: SetupDongleState | undefined =
    s.sensorKind !== 'webserial' ? undefined : sourceState !== 'connected' ? 'closed' : (dongle ?? 'waiting');
  const stepsResult = setupSteps(
    { ...readinessInput, referenceSetAt, activePresetName: activePreset?.name ?? null, battery, dongle: dongleState },
    now,
  );
  const stepOf = (id: SetupStepId) => stepsResult.steps.find((st) => st.id === id)!;

  // 센서를 쓰는 화면에서 준비가 처음 갖춰지면 최초 설정 완료로 기록한다(옛 [설정 완료] 버튼의 역할).
  // 키보드 전용은 보정을 거치지 않았으니 여기선 켜지 않고, 복귀할 때 켠다
  useEffect(() => {
    if (sensorMode && ready && !s.firstSetupDone) s.setFirstSetupDone(true);
  }, [sensorMode, ready, s]);

  // ---- 펼침: 사용자가 연 단계 ∪ 모자란 첫 단계(모자란 첫 단계가 바뀌면 새로 더한다) ----
  const [open, setOpen] = useState(() => initialOpen(stepsResult.firstNeeded));
  const [prevFirstNeeded, setPrevFirstNeeded] = useState(stepsResult.firstNeeded);
  if (prevFirstNeeded !== stepsResult.firstNeeded) {
    setPrevFirstNeeded(stepsResult.firstNeeded);
    setOpen(openOnFirstNeededChange(open, stepsResult.firstNeeded));
  }

  // 진입 시 한 번만 모자란 첫 단계로 스크롤(띠 높이만큼의 여백은 CSS scroll-margin-top)
  const entryStep = useRef(stepsResult.firstNeeded);
  useEffect(() => {
    const id = entryStep.current;
    if (!id) return;
    const raf = requestAnimationFrame(() => document.getElementById(STEP_DOM_ID[id])?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- ② 시작 위치 보정 (capturing 모드) ----
  const [capturing, setCapturing] = useState(false);
  const [snap, setSnap] = useState<ReferenceSnapshot>({ phase: 'idle', progress: 0, spread: 0 });
  const [capNote, setCapNote] = useState<string | null>(null);
  const capRef = useRef<ReferenceCapture | null>(null);
  const capCleanup = useRef<(() => void) | null>(null);

  const stopCapture = useCallback(() => {
    capCleanup.current?.();
    capCleanup.current = null;
    capRef.current = null;
    setCapturing(false);
  }, []);

  const startCapture = () => {
    stopCapture();
    const cap = new ReferenceCapture();
    capRef.current = cap;
    setCapNote(null);
    inputManager.setPoseStream(true);
    const offSnap = cap.subscribe((sn) => {
      setSnap(sn);
      if (sn.phase === 'done') {
        // 완료: 지금 자세를 기준으로 삼고 보정 시각을 남긴다
        inputManager.resetPose();
        useLive.setState({ referenceSetAt: Date.now(), referenceStale: false });
        setCapNote('시작 위치를 맞췄습니다');
        // 구독 콜백 안에서 해제하면 반복 중 변경이라 다음 틱에 정리한다
        window.setTimeout(() => {
          if (capRef.current === cap) stopCapture();
        }, 0);
      }
    });
    // 보정 대상은 0번 스틱 자세. 모의 IMU는 두 스틱이 같은 자세를 쓴다
    const offPose = inputManager.onPose((stickId, p) => {
      if (stickId === 0) cap.onPose(p, performance.now());
    });
    capCleanup.current = () => {
      offSnap();
      offPose();
    };
    setCapturing(true);
  };

  // 보정 중 연결이 모두 끊기면 처음부터 다시
  useEffect(() => {
    if (capturing && !anyConnected) capRef.current?.restart();
  }, [capturing, anyConnected]);

  // 언마운트 시 구독 해제. 자세 스트림은 다른 화면의 자세 마커가 쓰므로 켠 채 둔다
  useEffect(() => () => capCleanup.current?.(), []);

  // ---- 저장·이름 창 ----
  const [nameOpen, setNameOpen] = useState<NamePurpose | null>(null);

  const flashSaved = () => {
    setSavedFlash(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
  };

  const onSaveChanges = () => {
    void presets.saveChanges().then((ok) => ok && flashSaved());
  };

  const openNameDialog = (purpose: NamePurpose) => {
    presets.clearError();
    setNameOpen(purpose);
  };

  const cancelNameDialog = () => {
    presets.clearError();
    setNameOpen(null);
  };

  // ---- 복귀·이탈 ----
  const leaving = useRef(false); // 확인을 마친 이동은 blocker가 다시 막지 않게 한다
  const [returnConfirm, setReturnConfirm] = useState(false); // 복귀 버튼에서 연 이탈 확인
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // 메뉴 이동·뒤로 가기: 미저장 변경이 있으면 확인한다(보정 중이거나 확인을 마친 이동은 제외)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !capturing && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const leaveOpen = (blocker.state === 'blocked' || returnConfirm) && nameOpen === null;

  const doReturn = () => {
    s.setFirstSetupDone(true);
    leaving.current = true;
    navigate(returnTo ?? '/');
  };

  /** 확인을 마치고 실제로 나간다: 복귀 버튼에서 왔으면 returnTo로, 메뉴·뒤로 가기였으면 막았던 이동을 이어 간다 */
  const proceedLeave = () => {
    setLeaveError(null);
    if (returnConfirm) {
      setReturnConfirm(false);
      doReturn();
    } else if (blocker.state === 'blocked') {
      blocker.proceed();
    }
  };

  const onReturn = () => {
    if (dirty && !capturing) setReturnConfirm(true);
    else doReturn();
  };

  const cancelLeave = () => {
    presets.clearError();
    setLeaveError(null);
    setReturnConfirm(false);
    if (blocker.state === 'blocked') blocker.reset();
  };

  // [저장 안 함]: 적용 프리셋이 있으면 그 값으로 배치·사운드를 되돌린 뒤 나간다(없으면 되돌릴 기준이 없어 그대로)
  const discardAndLeave = () => {
    if (s.activePresetId) usePresets.getState().apply(s.activePresetId);
    proceedLeave();
  };

  const saveAndLeave = () => {
    if (!s.activePresetId) {
      openNameDialog('leave');
      return;
    }
    setLeaveError(null);
    presets.clearError(); // 앞선 오류가 이번 저장 결과로 오인되지 않게
    void usePresets
      .getState()
      .saveChanges()
      .then((ok) => {
        const { status, error } = usePresets.getState();
        if (!ok && status === 'error') setLeaveError(ERROR_TEXT[error ?? 'NETWORK']);
        else proceedLeave(); // 저장 성공(또는 이미 변경 없음)
      });
  };

  const saveNewName = (name: string) => {
    const purpose = nameOpen;
    void usePresets
      .getState()
      .saveAs(name)
      .then((ok) => {
        if (!ok) return; // 오류 문구는 이름 창이 presets.error로 보인다
        setNameOpen(null);
        if (purpose === 'leave') proceedLeave();
        else flashSaved();
      });
  };

  // ---- ① 연결 상태 문구(자유 연주와 같은 표현) ----
  const sensorDesc = sensorRegistry.get(s.sensorKind);
  let connText: string;
  if (!sensorMode) connText = '키보드만 사용합니다.';
  else if (sourceState === 'error') connText = `오류: ${sourceMessage ?? '알 수 없음'}`;
  else if (sourceState === 'connecting') connText = '연결 중…';
  else if (anyConnected)
    connText = `연결됨 (${connected[0] ? '왼손' : ''}${connected[0] && connected[1] ? '·' : ''}${connected[1] ? '오른손' : ''})`;
  else connText = '연결 안 됨';

  const lastHitText = lastHit
    ? `${lastHit.pad ? PAD_META[lastHit.pad].label : '판정 없음'} · 세기 ${lastHit.velocity} · ${lastHit.source}`
    : '아직 없음';

  // ---- 단계 카드 공통 ----
  const expandedOf = (id: SetupStepId) => isExpanded(open, id, stepOf(id).status) || (id === 'calibration' && capturing);
  const openStep = (id: SetupStepId) => setOpen((o) => openByUser(o, id));
  const collapseStep = (id: SetupStepId) => {
    if (id === 'calibration') stopCapture();
    setOpen((o) => collapse(o, id));
  };
  const actionLabelOf = (id: SetupStepId): string | undefined => {
    const { status } = stepOf(id);
    if (id === 'calibration') return status === 'skipped' ? undefined : status === 'done' ? '다시 하기' : '열기';
    // 스틱은 키보드 전용(skipped)이어도 센서를 고르려면 펼칠 수 있어야 한다
    return status === 'needed' ? '열기' : '변경';
  };
  const onActionOf = (id: SetupStepId) => () => {
    openStep(id);
    // 보정 [다시 하기]는 펼치고 바로 시작한다
    if (id === 'calibration' && stepOf(id).status === 'done' && anyConnected) startCapture();
  };

  const barText = !activePreset ? SETUP_BAR_NO_PRESET_TEXT : dirty ? SETUP_BAR_DIRTY_TEXT : setupBarCleanText(activePreset.name);
  const nameDialogError = presets.status === 'error' && presets.error ? ERROR_TEXT[presets.error] : null;
  const showPresetError = presets.status === 'error' && presets.error !== null && nameOpen === null;

  return (
    <main className="main wide setup-page">
      {returnTo && (
        <ReturnBanner
          {...returnBannerText(missing, connected, returnTargetName(returnTo, returnLabel))}
          buttonText={returnButtonText(returnTo, returnLabel)}
          ready={ready}
          enterEnabled={!leaveOpen && nameOpen === null && !capturing}
          onReturn={onReturn}
        />
      )}

      <div className="row setup-head">
        <h1>설정</h1>
        <span className="small dim">
          {stepsResult.total}단계 중 {stepsResult.doneCount}단계 완료
        </span>
      </div>

      <div className="setup-steps">
        {/* ① 스틱 연결 */}
        <StepCard
          id={STEP_DOM_ID.stick}
          index={1}
          title="스틱 연결"
          status={stepOf('stick').status}
          summary={stepOf('stick').summary}
          actionLabel={actionLabelOf('stick')}
          onAction={onActionOf('stick')}
          expanded={expandedOf('stick')}
          onCollapse={() => collapseStep('stick')}
        >
          <div className="col">
            {dongleState !== undefined && <DongleRow state={dongleState} connected={connected} busy={sourceState === 'connecting'} />}
            {sensorMode && (
              <div className="stick-cards">
                <StickCard hand={0} connected={connected[0]} batteryPct={battery[0]} />
                <StickCard hand={1} connected={connected[1]} batteryPct={battery[1]} />
              </div>
            )}
            <p className="small dim">키보드는 항상 켜져 있습니다. 센서를 고르면 센서 타격은 가상 키트 배치로 판정됩니다.</p>
            {[NO_SENSOR, ...sensorRegistry.list()].map((i) => (
              <label key={i.id} className="row sensor-choice">
                <input
                  type="radio"
                  name="sensor"
                  checked={s.sensorKind === i.id}
                  onChange={() => {
                    if (i.id === 'none') stopCapture(); // 키보드만으로 돌리면 보정 중단
                    s.setSensorKind(i.id);
                  }}
                  style={{ marginTop: 5 }}
                />
                <span className="col" style={{ gap: 0 }}>
                  <strong>{i.label}</strong>
                  <span className="small dim">{i.description}</span>
                </span>
              </label>
            ))}
            {sensorMode && <SensorOptionsPanel id={s.sensorKind} />}
            <p className="small">
              {sensorDesc?.label ?? '입력'} · {connText}
            </p>
            {sensorMode && padTable && <p className="small">{padTableText(padTable)}</p>}
            {sensorMode && yawDriftLine && <p className="small">{yawDriftLine}</p>}
            {sourceMessage && <div className={`notice ${sourceState === 'error' ? 'error' : ''}`}>{sourceMessage}</div>}
            {sensorMode && referenceStale && anyConnected && (
              <div className="notice">다시 연결됐습니다. 쳐 보고 필요하면 시작 위치를 다시 맞추세요</div>
            )}
          </div>
        </StepCard>

        {/* ② 시작 위치 보정 */}
        <StepCard
          id={STEP_DOM_ID.calibration}
          index={2}
          title="시작 위치 보정"
          status={stepOf('calibration').status}
          summary={stepOf('calibration').summary}
          actionLabel={actionLabelOf('calibration')}
          onAction={onActionOf('calibration')}
          expanded={expandedOf('calibration')}
          onCollapse={() => collapseStep('calibration')}
        >
          {!sensorMode ? (
            <p className="small dim">키보드 입력은 보정이 필요 없습니다.</p>
          ) : capturing ? (
            <div className="col">
              <p className="small">스틱을 들고 3초간 자세를 유지하세요</p>
              <div className="progress ref-progress">
                <div style={{ width: `${Math.round(snap.progress * 100)}%` }} />
              </div>
              <p className="small dim">
                {snap.phase === 'holding' ? `유지 중 ${(snap.progress * 3).toFixed(1)}초` : '자세가 흔들리면 처음부터 다시 셉니다'}
                {' · '}퍼짐 {snap.spread.toFixed(1)}°
              </p>
              {!anyConnected && <div className="notice error">스틱 연결이 끊겼습니다. 다시 연결되면 처음부터 진행합니다</div>}
              <div className="row">
                <button onClick={stopCapture}>취소</button>
              </div>
            </div>
          ) : (
            <div className="col">
              {capNote && <div className="notice">{capNote}</div>}
              <div className="row">
                <button className={referenceSetAt === null ? 'btn-primary' : ''} onClick={startCapture} disabled={!anyConnected}>
                  {referenceSetAt === null ? '시작 위치 맞추기' : '다시 맞추기'}
                </button>
              </div>
              {!anyConnected && <p className="small faint">스틱을 연결하면 보정할 수 있습니다.</p>}
            </div>
          )}
        </StepCard>

        {/* ③ 프리셋 */}
        <StepCard
          id={STEP_DOM_ID.preset}
          index={3}
          title="프리셋"
          status={stepOf('preset').status}
          summary={stepOf('preset').summary}
          actionLabel={actionLabelOf('preset')}
          onAction={onActionOf('preset')}
          expanded={expandedOf('preset')}
          onCollapse={() => collapseStep('preset')}
        >
          <div className="col">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">
                {activePreset ? (
                  <>
                    적용 중: <strong>{activePreset.name}</strong>
                    {dirty && <span className="preset-badge preset-dirty">변경됨</span>}
                  </>
                ) : (
                  <>
                    적용된 프리셋 없음
                    {dirty && <span className="preset-badge preset-dirty">저장 안 됨</span>}
                  </>
                )}
              </span>
              {presets.status === 'loading' && <span className="spinner" aria-label="불러오는 중" />}
            </div>
            {presets.items.length === 0 && presets.status !== 'loading' && (
              <p className="small dim">저장된 프리셋이 없습니다. 아래 드럼 배치를 정하고 [새 프리셋으로 저장]으로 이름을 붙여 저장하세요.</p>
            )}
            <div className="preset-list">
              {presets.items.map((p) => (
                <div key={p.id} className="preset-row">
                  <span className="preset-name">
                    {p.isDefault && (
                      <span className="preset-star" title="기본 프리셋">
                        ★
                      </span>
                    )}
                    {p.name}
                    {p.id === s.activePresetId && <span className="preset-badge">적용 중</span>}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <button className="small" onClick={() => presets.apply(p.id)} disabled={saving}>
                      적용
                    </button>
                    <button className="small" onClick={() => void presets.setDefault(p.id)} disabled={saving || p.isDefault}>
                      기본으로
                    </button>
                    <button className="small btn-danger" onClick={() => void presets.remove(p.id)} disabled={saving}>
                      삭제
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="row">
              <button disabled={saving} onClick={() => openNameDialog('save')}>
                새 프리셋으로 저장
              </button>
            </div>
            {showPresetError && (
              <div className="notice error row" style={{ justifyContent: 'space-between' }}>
                <span>{ERROR_TEXT[presets.error!]}</span>
                <button className="small" onClick={presets.clearError}>
                  닫기
                </button>
              </div>
            )}
          </div>
        </StepCard>
      </div>

      {/* 드럼 배치 절: 배치 편집기·사운드 세트·타격 확인(준비 조건이 아니라 단계가 아니다) */}
      <section className="setup-section" aria-labelledby="setup-kit-title">
        <h2 id="setup-kit-title">드럼 배치</h2>
        <div className="card col">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>배치 편집</h3>
            <button className="btn-ghost small" onClick={s.resetLayout}>
              기본 배치로
            </button>
          </div>
          <p className="small dim">
            패드를 끌어 원하는 자리에 둡니다. 배치가 곧 판정 영역이라 바로 쳐 보며 확인할 수 있습니다. 패드를 톡 치면 소리와 이펙트가
            나고, 끌면 위치만 바뀝니다.
          </p>
          <div className="chips">
            {PRESET_IDS.map((id) => (
              <button key={id} className="chip" onClick={() => s.applyLayoutPreset(id)}>
                {KIT_LAYOUT_PRESET_LABELS[id]}
              </button>
            ))}
            <span className="small dim" style={{ marginLeft: 8 }}>
              세기
            </span>
            {VELOCITY_CHOICES.map((c) => (
              <button key={c.v} className={`chip ${s.testVelocity === c.v ? 'active' : ''}`} onClick={() => s.setTestVelocity(c.v)}>
                {c.label}
              </button>
            ))}
          </div>
          <KitCanvas
            layout={s.kitLayout}
            draggable
            onMovePad={s.movePad}
            onTapPad={testPad}
            hits={hits}
            keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
            anchors={anchors}
            angleRange={s.tuning.angleRange}
            poses={pose}
            showPoses={sensorMode}
            surfaceRef={bindSensorSurface}
          />
          <div className="field">
            <label>사운드 세트</label>
            <select value={s.soundSetId} onChange={(e) => s.setSoundSetId(e.target.value as SoundSetId)}>
              {(['ssaplash', 'synth'] as SoundSetId[]).map((id) => (
                <option key={id} value={id}>
                  {SOUND_SET_LABELS[id]}
                </option>
              ))}
            </select>
            <p className="small faint">
              {s.soundSetId === 'synth'
                ? '합성음을 씁니다.'
                : soundSetState === 'loading'
                  ? '샘플 불러오는 중… (그동안은 합성음)'
                  : soundSetState === 'error'
                    ? '샘플을 불러오지 못해 합성음을 씁니다.'
                    : soundSetState === 'ready'
                      ? soundSetMissing.length > 0
                        ? `샘플 준비됨 · 합성음으로 대체: ${soundSetMissing.map((p) => PAD_META[p].label).join(', ')}`
                        : '샘플 준비됨'
                      : '소리를 한 번 내면 샘플을 불러옵니다.'}
            </p>
          </div>
        </div>

        <div className="card col">
          <h3>타격 확인</h3>
          {sensorMode && !anyConnected && <div className="notice error">스틱 입력 중단 — 연결을 확인하세요. 편집은 계속할 수 있습니다.</div>}
          <p className="small dim">마지막 타격: {lastHitText}</p>
          <div className="chips">
            {LANE_PADS.map((pad) => (
              <button key={pad} className="chip" onClick={() => testPad(pad)}>
                {PAD_META[pad].label} 소리
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 고급 설정: 판정 반경·연주 환경(설정 스토어에 즉시 저장되어 미저장 판정 대상이 아니다) */}
      <details className="card setup-advanced">
        <summary>고급 설정</summary>
        <div className="col setup-advanced-body">
          <h3>판정 반경</h3>
          <div className="field">
            <label>판정 반경 상한 {s.tuning.maxRadiusDeg}°</label>
            <input type="range" min={TUNING_RANGES.maxRadiusDeg.min} max={TUNING_RANGES.maxRadiusDeg.max} step={TUNING_RANGES.maxRadiusDeg.step} value={s.tuning.maxRadiusDeg} onChange={(e) => s.setTuning({ maxRadiusDeg: +e.target.value })} />
          </div>

          <h3>연주 환경</h3>
          <div className="field">
            <label>
              판정 폭 Perfect ±{s.timing.perfectMs}ms · Good ±{s.timing.goodMs}ms
            </label>
            <input type="range" min={10} max={60} step={5} value={s.timing.perfectMs} onChange={(e) => s.setTiming({ ...s.timing, perfectMs: +e.target.value })} />
            <input type="range" min={30} max={150} step={5} value={s.timing.goodMs} onChange={(e) => s.setTiming({ ...s.timing, goodMs: +e.target.value })} />
          </div>
          <div className="field">
            <label>오디오 오프셋 {s.audioOffsetMs}ms (양수 = 소리가 늦게 들릴 때)</label>
            <input type="range" min={-100} max={200} step={5} value={s.audioOffsetMs} onChange={(e) => s.setAudioOffsetMs(+e.target.value)} />
          </div>
          <div className="field">
            <label>노트 낙하 시간 {s.scrollMs}ms</label>
            <input type="range" min={600} max={3000} step={100} value={s.scrollMs} onChange={(e) => s.setScrollMs(+e.target.value)} />
          </div>
          <div className="field">
            <label>볼륨 {Math.round(s.volume * 100)}%</label>
            <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => s.setVolume(+e.target.value)} />
          </div>
          <label className="row">
            <input type="checkbox" checked={s.metronome} onChange={(e) => s.setMetronome(e.target.checked)} /> 플레이 중 메트로놈
          </label>
          <div className="field">
            <label>카운트인 마디</label>
            <select value={s.countInBars} onChange={(e) => s.setCountInBars(+e.target.value)}>
              <option value={0}>없음</option>
              <option value={1}>1마디</option>
              <option value={2}>2마디</option>
            </select>
          </div>
          <p className="small faint">
            오디오 지연 실측: {lat ? `base ${lat.baseLatencyMs.toFixed(1)}ms · output ${lat.outputLatencyMs.toFixed(1)}ms · ${lat.sampleRate}Hz` : '소리를 한 번 내면 표시됩니다'}
          </p>
        </div>
      </details>

      {/* 하단 고정 바: 저장 안내 + 저장 */}
      <div className="setup-bar">
        <span className={`small ${dirty ? 'setup-bar-dirty' : 'dim'}`}>{barText}</span>
        <span className="row">
          {saving && <span className="spinner" aria-label="저장 중" />}
          {savedFlash && <span className="small preset-saved">저장됨</span>}
          {activePreset ? (
            <button className="btn-primary" disabled={!dirty || saving} onClick={onSaveChanges}>
              저장
            </button>
          ) : (
            <button className="btn-primary" disabled={saving} onClick={() => openNameDialog('save')}>
              새 프리셋으로 저장
            </button>
          )}
        </span>
      </div>

      <UnsavedLeaveDialog
        open={leaveOpen}
        message={unsavedLeaveText(activePreset?.name ?? null)}
        busy={saving}
        error={leaveError}
        onCancel={cancelLeave}
        onDiscard={discardAndLeave}
        onSave={saveAndLeave}
      />
      <PresetNameDialog
        open={nameOpen !== null}
        existing={presets.items}
        busy={saving}
        error={nameDialogError}
        onSave={saveNewName}
        onCancel={cancelNameDialog}
      />
    </main>
  );
}

/** ① 본문 동글 줄: 포트가 안 열렸으면 [동글 연결], 열렸으면 상태 + [다른 동글 연결]. 클릭 안에서 포트 선택 창을 연다 */
function DongleRow({ state, connected, busy }: { state: SetupDongleState; connected: [boolean, boolean]; busy: boolean }) {
  const line = dongleLine(state, connected);
  const onClick = () => void connectSensor();
  return (
    <div className="dongle-row">
      {line.dot === null ? (
        <button type="button" className="btn-primary" onClick={onClick} disabled={busy}>
          {line.action}
        </button>
      ) : (
        <span className={`stick-dot ${line.dot}`} />
      )}
      <span className={`dongle-row-text ${line.dot === null ? 'dim' : ''}`}>{line.text}</span>
      {line.dot !== null && (
        <button type="button" className="btn-ghost small" onClick={onClick} disabled={busy}>
          {line.action}
        </button>
      )}
    </div>
  );
}
