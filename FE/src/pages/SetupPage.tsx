// 통합 설정 페이지(/setup, Figma 03 드럼 세팅, UX-64). 단계 카드 2장(스틱 연결·시작 위치 보정) → 드럼 배치 카드(프리셋 칩 줄·배치·선택 패드·타격 확인) → 접힌 고급 설정 → 하단 고정 바.
// 프리셋 고르기·고치기·저장은 드럼 배치 카드 한 곳이다: 칩으로 적용, [추가하기]로 패드별 2타 보정 → 새 프리셋 저장, [전체 보정]·[이 드럼 다시 치기]로 적용 프리셋 편집.
// 연주 준비에서 왔으면(returnTo) 위에 복귀 띠를 고정하고, 저장하지 않은 변경이 있으면 나가기 전에 확인한다.
// 단계 판정·문구는 domain/setupSteps, 펼침 규칙은 domain/setupExpand, 저장은 presetStore, 보정·재정렬은 app/calibrationSession이 맡고
// 이 페이지는 조립과 표시만 한다. 판정은 손별 앵커(stickAnchors, 적용 프리셋의 사본)가 맡고 배치(kitLayout)는 표시 전용이다(PLAY-004 D1·D2).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { KitCanvas } from '@/components/KitCanvas';
import { useRecentHits } from '@/components/drum/useRecentHits';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { HitLog } from '@/components/setup/HitLog';
import { HIT_LOG_ROWS } from '@/components/setup/hitLogFormat';
import '@/components/setup/setup.css';
import { SensorOptionsPanel } from '@/components/SensorOptionsPanel';
import { useHitFx } from '@/components/useHitFx';
import { PresetChips } from '@/components/setup/PresetChips';
import { PresetNameDialog } from '@/components/setup/PresetNameDialog';
import { PresetSlotDialog } from '@/components/setup/PresetSlotDialog';
import { ReturnBanner } from '@/components/setup/ReturnBanner';
import { StatusTile } from '@/components/setup/StatusTile';
import { StickCard } from '@/components/setup/StickCard';
import { RadiusSlider } from '@/components/calibration/RadiusSlider';
import { UnsavedLeaveDialog } from '@/components/setup/UnsavedLeaveDialog';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { selectDirty, usePresets } from '@/store/presetStore';
import { PAD_META, STICK_PADS, type PadId } from '@/domain/pads';
import type { HitFx } from '@/domain/events';
import { KEY_MAP } from '@/domain/keyMap';
import { anchorsToProfile } from '@/domain/kitJudge';
import { isSystemPreset, presetDisplayName, type CaptureDraft, type PresetErrorCode } from '@/domain/preset';
import type { PadTableStatus, YawDriftStatus } from '@/domain/calibration';
import { sanitizeReturnTo } from '@/domain/auth';
import { calibrationReady, readiness } from '@/domain/readiness';
import { pedalSetupLine, pedalStatus } from '@/domain/pedalStatus';
import {
  dongleLine,
  returnBannerText,
  returnButtonText,
  returnTargetName,
  setupBarView,
  setupSteps,
  unsavedLeaveText,
  type SetupDongleState,
  type SetupStepId,
} from '@/domain/setupSteps';
import { collapse, initialOpen, isExpanded, openByUser, openOnFirstNeededChange } from '@/domain/setupExpand';
import { DRIFT_COOLDOWN_MS, DRIFT_MIN_DEG, TUNING_RANGES } from '@/domain/tuning';
import { audioEngine } from '@/audio/AudioEngine';
import { CalibrationStage } from '@/components/calibration/CalibrationStage';
import { useRealign } from '@/components/useRealign';
import { calibrationSession } from '@/app/calibrationSession';
import { sensorRegistry } from '@/app/sensorRegistry';
import { bindSensorSurface, connectSensor, setSoundOnHit } from '@/app/bootstrap';
import { KEYBOARD_INPUT_ENABLED } from '@/app/sources';

/** 편집기 표시 크기(Figma 720×320). 위치 값은 이 좌표계의 px로 보여 준다 */
const EDITOR_W = 720;
const EDITOR_H = 320;

const COUNT_IN_OPTIONS = [
  { value: '0', label: '없음' },
  { value: '1', label: '1마디' },
  { value: '2', label: '2마디' },
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

/** 한 손에 보낸 패드 표의 적용 상태. 500ms 확인 창이 지났는지는 1초 tick 리렌더로 갱신된다 */
function padTableHandText(t: PadTableStatus): string {
  if (t.acked !== null) return t.acked === t.sent ? `${t.sent}개 적용됨` : `적용 ${t.acked}개 / 전송 ${t.sent}개`;
  if (performance.now() - t.at > 500) return `확인 없음(${t.sent}개 전송)`;
  return '전송 중…';
}

/** 손별 패드 표 문구: "스틱 패드 표 · 왼손 7개 적용됨 · 오른손 7개 적용됨". 둘 다 없으면 null */
function padTablesText(t: readonly [PadTableStatus | null, PadTableStatus | null]): string | null {
  const parts = (['왼손', '오른손'] as const).flatMap((name, i) => (t[i] ? [`${name} ${padTableHandText(t[i]!)}`] : []));
  return parts.length ? `스틱 패드 표 · ${parts.join(' · ')}` : null;
}

/** 보정 시각 "HH:MM"(같은 날) 또는 "M/D HH:MM"(칩 줄 pill용) */
function calibratedText(at: number | null, now: number): string | null {
  if (at === null) return null;
  const d = new Date(at);
  const n = new Date(now);
  const two = (v: number) => String(v).padStart(2, '0');
  const hhmm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? hhmm : `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
}

/** 이름 창을 연 이유: leave = 미저장 이탈 확인에서 [저장하고 나가기], save = 일반 저장(하단 바), draft = 추가하기 보정 결과 저장(UX-64) */
type NamePurpose = 'leave' | 'save' | 'draft';

export function SetupPage() {
  const s = useSettings();
  const presets = usePresets();
  const connected = useLive((l) => l.connected);
  const pedal = useLive((l) => l.pedal.connected);
  const pedalBattery = useLive((l) => l.pedal.battery);
  const battery = useLive((l) => l.battery);
  const pose = useLive((l) => l.pose);
  const sourceState = useLive((l) => l.sourceState);
  const sourceMessage = useLive((l) => l.sourceMessage);
  const dongle = useLive((l) => l.dongle);
  const padTable = useLive((l) => l.padTable);
  const yawDrift = useLive((l) => l.yawDrift);
  const referenceSetAt = useLive((l) => l.referenceSetAt);
  const referenceStale = useLive((l) => l.referenceStale);
  const realignNeeded = useLive((l) => l.realignNeeded);
  const calibration = useLive((l) => l.calibration);
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
  const systemPreset = isSystemPreset(s.activePresetId);
  const activePresetName = presetDisplayName(presets.items, s.activePresetId);
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

  // 판정 원은 손별 앵커 프로필로 그린다(판정과 같은 규칙, PLAY-004 D1). 보정 안 된 손은 그리지 않는다
  const anchorSets = useMemo(
    () =>
      [
        s.stickAnchors[0] ? anchorsToProfile(s.stickAnchors[0], s.tuning, 0).anchors : null,
        s.stickAnchors[1] ? anchorsToProfile(s.stickAnchors[1], s.tuning, 1).anchors : null,
      ] as const,
    [s.stickAnchors, s.tuning],
  );
  const hasAnchors: [boolean, boolean] = [s.stickAnchors[0] !== null, s.stickAnchors[1] !== null];

  const lat = audioEngine.latency();
  const recentHits = useRecentHits(HIT_LOG_ROWS);
  const [selectedPad, setSelectedPad] = useState<PadId>('SNARE');
  const [advOpen, setAdvOpen] = useState(false);
  const selectedPlacement = s.kitLayout[selectedPad];
  // 선택 패드의 판정 반경(°): 양손 앵커 중 있는 것의 평균. 앵커가 없으면(시스템 기본·미보정) 슬라이더 없음
  const selectedRadius = useMemo(() => {
    const radii = [s.stickAnchors[0]?.[selectedPad]?.radius, s.stickAnchors[1]?.[selectedPad]?.radius].filter((r): r is number => r !== undefined);
    return radii.length ? radii.reduce((a, b) => a + b, 0) / radii.length : null;
  }, [s.stickAnchors, selectedPad]);

  // 타격 이펙트. 키보드·센서 타격이 live의 hitSeq로 들어온다(편집기 마우스 클릭은 타격이 아니다)
  const hits = useRef(new Map<PadId, HitFx>());
  useHitFx(hits);

  // ---- 단계 판정(적용 프리셋 기준 보정 완료, PLAY-004 D9·UX-64 D7) ----
  const readinessInput = {
    sensorKind: s.sensorKind,
    connected,
    pedal,
    firstSetupDone: calibrationReady({ systemPreset, connected, hasAnchors, realignNeeded }),
  };
  const { ready, missing } = readiness(readinessInput);
  // 동글 상태는 동글 소스(Web Serial)일 때만. 포트가 열렸는데 LINK 전이면 waiting(예전 동글 펌웨어 포함)
  const dongleState: SetupDongleState | undefined =
    s.sensorKind !== 'webserial' ? undefined : sourceState !== 'connected' ? 'closed' : (dongle ?? 'waiting');
  const stepsResult = setupSteps({ ...readinessInput, referenceSetAt, realignNeeded, systemPreset, battery, dongle: dongleState }, now);
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

  // ---- 2타 보정(PLAY-004, UX-64). 로직은 calibrationSession, 여기선 시작·다음·저장·취소만 ----
  const capturing = calibration.mode === 'capture';
  const realigning = calibration.mode === 'realign';
  const captureTarget = capturing ? calibration.target : null;
  const stopCapture = () => calibrationSession.cancelCapture();
  const startFull = () => calibrationSession.startCapture({ target: 'active' });
  const startAdd = () => calibrationSession.startCapture({ target: 'new' });
  const calibrating = calibration.capture && captureTarget ? { target: captureTarget, index: calibration.capture.index, total: calibration.capture.order.length } : null;
  // 스틱이 다시 켜진 손이 있으면 재정렬 세션을 자동으로 시작한다(네 진입점 공용 훅)
  useRealign(sensorMode);

  // 언마운트 시 진행 중인 보정은 접는다(표를 비워 둔 채 나가지 않게)
  useEffect(() => () => calibrationSession.cancelCapture(), []);

  // ---- 저장·이름 창 ----
  const [nameOpen, setNameOpen] = useState<NamePurpose | null>(null);
  /** 추가하기 보정 결과. 이름 창에서 저장하거나 취소하면 비운다(저장 전까지 설정은 그대로, UX-64 D4) */
  const [draft, setDraft] = useState<CaptureDraft | null>(null);

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

  /** 초안을 들고 연 슬롯 창(Figma ④). 빈 슬롯을 고르면 그 번호를 들고 이름 창(⑤)으로 */
  const [slotOpen, setSlotOpen] = useState(false);
  const [draftSlot, setDraftSlot] = useState<number | null>(null);

  const cancelNameDialog = () => {
    presets.clearError();
    setNameOpen(null);
    setDraft(null);
    setDraftSlot(null);
  };

  const closeSlotDialog = () => {
    setSlotOpen(false);
    setDraft(null);
    setDraftSlot(null);
  };

  /** 마지막 패드의 [저장]: 확인 대기를 끝내고(next) 세션을 마친다. 추가하기면 초안을 들고 슬롯 창을 연다 */
  const onCaptureSave = () => {
    calibrationSession.next();
    const result = calibrationSession.finish();
    if (result) {
      setDraft(result);
      setSlotOpen(true);
    } else {
      flashSaved();
    }
  };

  const onPickEmptySlot = (slot: number) => {
    setSlotOpen(false);
    setDraftSlot(slot);
    openNameDialog('draft');
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

  // [저장 안 함]: 적용 프리셋의 값으로 배치·사운드를 되돌린 뒤 나간다(시스템 기본은 고정 배치로)
  const discardAndLeave = () => {
    usePresets.getState().apply(s.activePresetId);
    proceedLeave();
  };

  const saveAndLeave = () => {
    if (!presets.items.some((p) => p.id === s.activePresetId)) {
      // 적용 프리셋이 목록에 없다(저장소 전환 직후): 새 프리셋으로 저장
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
      .saveAs(name, purpose === 'draft' ? (draft ?? undefined) : undefined)
      .then((ok) => {
        if (!ok) return; // 오류 문구는 이름 창이 presets.error로 보인다
        setNameOpen(null);
        setDraft(null);
        setDraftSlot(null);
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

  // ---- 상태 타일 공통(Setup / StatusTile): 누르면 아래로 펼치고 다시 누르면 접는다 ----
  const expandedOf = (id: SetupStepId) => isExpanded(open, id, stepOf(id).status) || (id === 'calibration' && realigning);
  const toggleStep = (id: SetupStepId) => setOpen((o) => (expandedOf(id) ? collapse(o, id) : openByUser(o, id)));
  /** 타일 상태 한 단어(Figma StatusTile status 줄) */
  const tileStatusText = (id: SetupStepId): string => {
    const { status } = stepOf(id);
    if (status === 'skipped') return '필요 없음';
    if (id === 'stick') return status === 'done' ? '연결됨' : '연결 안 됨';
    return status === 'done' ? '보정됨' : '보정 필요';
  };

  const bar = setupBarView({
    activePresetName,
    dirty,
    leaving: leaveOpen || nameOpen === 'leave',
    calibrating,
    draft: draft ? { slot: draftSlot } : null,
  });
  const nameDialogError = presets.status === 'error' && presets.error ? ERROR_TEXT[presets.error] : null;
  const showPresetError = presets.status === 'error' && presets.error !== null && nameOpen === null;
  const calNeeded = stepOf('calibration').status === 'needed' && !realigning;

  return (
    <main className="main setup-page">
      {returnTo && (
        <ReturnBanner
          {...returnBannerText(missing, connected, returnTargetName(returnTo, returnLabel))}
          buttonText={returnButtonText(returnTo, returnLabel)}
          ready={ready}
          enterEnabled={!leaveOpen && nameOpen === null && !capturing}
          onReturn={onReturn}
        />
      )}

      <div className="setup-head">
        <h1>연주 환경 설정</h1>
        <span className="setup-progress">
          {stepsResult.total}단계 중 {stepsResult.doneCount}단계 완료
        </span>
      </div>

      <div className="setup-tiles">
        {/* ① 스틱 연결 */}
        <StatusTile
          id={STEP_DOM_ID.stick}
          title="스틱 연결"
          status={stepOf('stick').status}
          statusText={tileStatusText('stick')}
          summary={stepOf('stick').summary}
          expanded={expandedOf('stick')}
          onToggle={() => toggleStep('stick')}
          urgent={returnTo !== null}
        >
          <div className="setup-col">
            {dongleState !== undefined && <DongleRow state={dongleState} connected={connected} busy={sourceState === 'connecting'} />}
            {sensorMode && (
              <div className="setup-stick-cards">
                <StickCard hand={0} connected={connected[0]} batteryPct={battery[0]} />
                <StickCard hand={1} connected={connected[1]} batteryPct={battery[1]} />
              </div>
            )}
            {sensorMode && dongleState !== undefined && (
              <PedalRow pedal={{ connected: pedal, battery: pedalBattery }} dongle={dongleState} />
            )}
            <p className="setup-note">키보드는 항상 켜져 있습니다. 센서를 고르면 센서 타격은 가상 키트 배치로 판정됩니다.</p>
            {[NO_SENSOR, ...sensorRegistry.list()].map((i) => (
              <label key={i.id} className="setup-sensor-choice">
                <input
                  type="radio"
                  name="sensor"
                  checked={s.sensorKind === i.id}
                  onChange={() => {
                    if (i.id === 'none') stopCapture(); // 키보드만으로 돌리면 보정 중단
                    s.setSensorKind(i.id);
                  }}
                />
                <span className="setup-sensor-choice-text">
                  <strong>{i.label}</strong>
                  <span>{i.description}</span>
                </span>
              </label>
            ))}
            {sensorMode && <SensorOptionsPanel id={s.sensorKind} />}
            <p className="setup-note">
              {sensorDesc?.label ?? '입력'} · {connText}
            </p>
            {sensorMode && padTablesText(padTable) && <p className="setup-note">{padTablesText(padTable)}</p>}
            {sensorMode && yawDriftLine && <p className="setup-note">{yawDriftLine}</p>}
            {sourceMessage && <div className={`setup-notice ${sourceState === 'error' ? 'error' : ''}`}>{sourceMessage}</div>}
            {sensorMode && referenceStale && anyConnected && !realignNeeded[0] && !realignNeeded[1] && (
              <div className="setup-notice">다시 연결됐습니다. 쳐 보고 판정이 밀리면 ②에서 시작 위치를 다시 잡으세요</div>
            )}
          </div>
        </StatusTile>

        {/* ② 시작 위치 보정(기준 자세·스네어 재정렬, UX-64 D7). 2타 보정은 아래 드럼 배치 카드에서 한다 */}
        <StatusTile
          id={STEP_DOM_ID.calibration}
          title="시작 위치 보정"
          status={stepOf('calibration').status}
          statusText={tileStatusText('calibration')}
          summary={stepOf('calibration').summary}
          expanded={expandedOf('calibration')}
          onToggle={() => toggleStep('calibration')}
          urgent={returnTo !== null}
        >
          {!sensorMode ? (
            <p className="setup-note">키보드 입력은 보정이 필요 없습니다.</p>
          ) : realigning ? (
            <CalibrationStage onRestart={anyConnected && !systemPreset ? startFull : undefined} />
          ) : (
            <div className="setup-col">
              <p className="setup-note">스틱을 정면으로 들고 [시작 위치 잡기]를 누르면 기준 자세가 다시 잡혀요. 판정이 한쪽으로 밀릴 때 눌러요.</p>
              <div className="setup-row">
                <Button variant={calNeeded ? 'primary' : 'secondary'} onClick={() => calibrationSession.resetPose()} disabled={!anyConnected || capturing}>
                  시작 위치 잡기
                </Button>
              </div>
              {calNeeded && !systemPreset && <p className="setup-note">드럼 위치는 아래 드럼 배치 카드에서 [전체 보정] 또는 [추가하기]로 잡아요.</p>}
              {!anyConnected && <p className="setup-note faint">스틱을 연결하면 보정할 수 있습니다.</p>}
            </div>
          )}
        </StatusTile>
      </div>

      {/* 드럼 배치 카드: 프리셋 칩 줄 · 배치 편집기(보정 중에는 보정 무대) · 선택 패드 정보 · 타격 확인(준비 조건이 아니라 단계가 아니다) */}
      <Card padding="md" className="setup-kit" role="region" aria-labelledby="setup-kit-title">
        <h2 id="setup-kit-title" className="setup-card-title">
          드럼 배치
        </h2>
        <p className="setup-card-desc">
          {capturing
            ? '불이 들어온 패드를 2번 쳐요. 값이 맞으면 [다음], 다시 치려면 [다시]를 눌러요'
            : '프리셋을 골라 고쳐요. 추가하기를 누르면 패드마다 2번씩 쳐서 새 배치를 만들어요'}
        </p>
        <PresetChips
          presets={presets.items}
          activeId={s.activePresetId}
          calibrating={calibrating}
          calibratedText={calibratedText(s.calibratedAt, now)}
          sensorMode={sensorMode}
          canCalibrate={anyConnected}
          busy={saving}
          onSelect={(id) => presets.apply(id)}
          onAdd={startAdd}
          onFullCalibrate={startFull}
          onCancel={stopCapture}
        />
        {showPresetError && (
          <div className="setup-notice error setup-row" style={{ justifyContent: 'space-between' }}>
            <span>{ERROR_TEXT[presets.error!]}</span>
            <Button variant="secondary" size="sm" onClick={presets.clearError}>
              닫기
            </Button>
          </div>
        )}
        {capturing ? (
          <CalibrationStage onSave={onCaptureSave} />
        ) : (
          <div className="setup-kit-body">
            <div className="setup-kit-left">
              {/* 마우스는 고르기만 한다. 소리·타격 기록은 스틱·키보드로만(포인터 모의 IMU의 클릭 타격도 막는다) */}
              <div className="setup-editor" data-no-pointer-strike>
                <KitCanvas
                  layout={s.kitLayout}
                  onTapPad={setSelectedPad}
                  highlightPad={selectedPad}
                  hits={hits}
                  keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
                  anchorSets={anchorSets}
                  angleRange={s.tuning.angleRange}
                  poses={pose}
                  showPoses={sensorMode}
                  surfaceRef={bindSensorSurface}
                />
              </div>
              {systemPreset && sensorMode && <p className="setup-note">고정 배치예요. 그 자리를 찾아 치세요. 내 자리로 바꾸려면 [추가하기]로 새 프리셋을 만들어요.</p>}
            </div>
            {/* 선택 패드 카드(Figma 정보 영역 765:33431, UX-62) */}
            <div className="setup-padinfo">
              <div className="setup-padinfo-head">
                <span className="setup-padinfo-caption">선택 패드</span>
                <h3 className="setup-padinfo-title">{PAD_META[selectedPad].label}</h3>
              </div>
              <hr className="setup-padinfo-rule" />
              <dl className="setup-padinfo-values">
                <div>
                  <dt>위치 X</dt>
                  <dd>{Math.round(selectedPlacement.x * EDITOR_W)}</dd>
                </div>
                <div>
                  <dt>위치 Y</dt>
                  <dd>{Math.round(selectedPlacement.y * EDITOR_H)}</dd>
                </div>
                {selectedRadius === null && (
                  <div>
                    <dt>반지름</dt>
                    <dd>{Math.round(selectedPlacement.r * EDITOR_W)}</dd>
                  </div>
                )}
              </dl>
              {/* 판정 반경(°) 슬라이더(UX-64 D9): 보정된 패드만. 양손 앵커에 덮어쓰고 스틱 표에도 간다 */}
              {selectedRadius !== null && (
                <RadiusSlider
                  value={selectedRadius}
                  min={s.tuning.minRadiusDeg}
                  max={s.tuning.maxRadiusDeg}
                  disabled={systemPreset}
                  onChange={(v) => s.setRadiusOverride(selectedPad, v)}
                />
              )}
              <div className="setup-padinfo-foot">
                <p className="setup-padinfo-hint">
                  패드를 눌러 고르면 위치를 볼 수 있어요. 한 드럼만 다른 자리로 옮기려면 [이 드럼 다시 치기]로 그 자리를 2번씩 쳐요.
                </p>
                {/* 패드 단위 재보정(PLAY-004 후속 T9): 선택한 스틱 패드만 연결된 손마다 2타. 시스템 기본은 편집 불가 */}
                {sensorMode && STICK_PADS.includes(selectedPad) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => calibrationSession.startCapture({ target: 'active', pads: [selectedPad] })}
                    disabled={!anyConnected || systemPreset}
                  >
                    이 드럼 다시 치기
                  </Button>
                )}
                {/* 선택 패드만이 아니라 전체 배치를 되돌린다(이전 화면의 「기본 배치로」와 같은 동작) */}
                <Button variant="text" size="sm" onClick={s.resetLayout} disabled={systemPreset}>
                  기본 배치로
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="setup-hit">
          <h3 className="setup-hit-title">타격 확인</h3>
          {sensorMode && !anyConnected && <div className="setup-notice error">스틱 입력 중단 — 연결을 확인하세요. 편집은 계속할 수 있습니다.</div>}
          <HitLog hits={recentHits} now={now} />
        </div>
      </Card>

      {/* 고급 설정: 판정 반경·연주 환경(설정 스토어에 즉시 저장되어 미저장 판정 대상이 아니다) */}
      <Card padding="md" className="setup-adv" role="region" aria-labelledby="setup-adv-title">
        <div className="setup-card-head">
          <div className="setup-step-main">
            <h2 id="setup-adv-title" className="setup-card-title">
              고급 설정
            </h2>
            <p className="setup-card-desc">판정 반경 · 판정 폭 · 노트 낙하 · 카운트인 · 메트로놈</p>
          </div>
          <Button variant="text" className="setup-step-action" aria-expanded={advOpen} aria-controls="setup-adv-body" onClick={() => setAdvOpen((v) => !v)}>
            {advOpen ? '접기' : '펼치기'}
          </Button>
        </div>
        {advOpen && (
          <div id="setup-adv-body" className="setup-adv-body">
            <Slider
              label="판정 반경 하한"
              min={TUNING_RANGES.minRadiusDeg.min}
              max={TUNING_RANGES.minRadiusDeg.max}
              step={TUNING_RANGES.minRadiusDeg.step}
              value={s.tuning.minRadiusDeg}
              valueText={`${s.tuning.minRadiusDeg}°`}
              onChange={(v) => s.setTuning({ minRadiusDeg: v })}
            />
            <Slider
              label="판정 반경 상한"
              min={TUNING_RANGES.maxRadiusDeg.min}
              max={TUNING_RANGES.maxRadiusDeg.max}
              step={TUNING_RANGES.maxRadiusDeg.step}
              value={s.tuning.maxRadiusDeg}
              valueText={`${s.tuning.maxRadiusDeg}°`}
              onChange={(v) => s.setTuning({ maxRadiusDeg: v })}
            />
            <Slider
              label="판정 폭 Perfect"
              min={10}
              max={60}
              step={5}
              value={s.timing.perfectMs}
              valueText={`±${s.timing.perfectMs}ms`}
              onChange={(v) => s.setTiming({ ...s.timing, perfectMs: v })}
            />
            <Slider
              label="판정 폭 Good"
              min={30}
              max={150}
              step={5}
              value={s.timing.goodMs}
              valueText={`±${s.timing.goodMs}ms`}
              onChange={(v) => s.setTiming({ ...s.timing, goodMs: v })}
            />
            <Slider
              label="노트 낙하 시간"
              min={600}
              max={3000}
              step={100}
              value={s.scrollMs}
              valueText={`${s.scrollMs}ms`}
              onChange={(v) => s.setScrollMs(v)}
            />
            <div className="setup-adv-item">
              <span className="setup-adv-label">카운트인 마디</span>
              <Segmented
                label="카운트인 마디"
                options={COUNT_IN_OPTIONS}
                value={String(s.countInBars)}
                onChange={(v) => s.setCountInBars(Number(v))}
              />
            </div>
            <div className="setup-adv-switch">
              <span>플레이 중 메트로놈</span>
              <Toggle label="플레이 중 메트로놈" checked={s.metronome} onChange={s.setMetronome} />
            </div>
            <p className="setup-adv-foot">
              오디오 지연 실측: {lat ? `base ${lat.baseLatencyMs.toFixed(1)}ms · output ${lat.outputLatencyMs.toFixed(1)}ms · ${lat.sampleRate}Hz` : '소리를 한 번 내면 표시됩니다'}
            </p>
          </div>
        )}
      </Card>

      {/* 하단 고정 바: 저장 안내 + 저장(설계 4-5 4상태 + 보정 중) */}
      <div className={`setup-bar ${bar.tone}`}>
        <span className="setup-bar-text">
          {bar.tone !== 'caption' && <span className="setup-bar-dot" aria-hidden="true" />}
          {bar.text}
        </span>
        <span className="setup-bar-right">
          {saving && <span className="spinner" aria-label="저장 중" />}
          {savedFlash && <span className="setup-bar-saved">저장됨</span>}
          {bar.button === 'save' ? (
            <Button className="setup-bar-action" disabled={!bar.buttonEnabled || saving} onClick={onSaveChanges}>
              저장
            </Button>
          ) : (
            <Button className="setup-bar-action wide" disabled={saving || capturing} onClick={() => openNameDialog('save')}>
              새 프리셋으로 저장
            </Button>
          )}
        </span>
      </div>

      <UnsavedLeaveDialog
        open={leaveOpen}
        message={unsavedLeaveText(activePresetName)}
        busy={saving}
        error={leaveError}
        onCancel={cancelLeave}
        onDiscard={discardAndLeave}
        onSave={saveAndLeave}
      />
      <PresetSlotDialog
        open={slotOpen}
        presets={presets.items}
        activeId={s.activePresetId}
        draftMode={draft !== null}
        busy={saving}
        onApply={(id) => {
          presets.apply(id);
          setSlotOpen(false);
        }}
        onPickEmpty={onPickEmptySlot}
        onClose={closeSlotDialog}
      />
      <PresetNameDialog
        open={nameOpen !== null}
        existing={presets.items}
        busy={saving}
        error={nameDialogError}
        initialValue={nameOpen === 'draft' && draftSlot !== null ? `새 프리셋 ${draftSlot}` : undefined}
        onSave={saveNewName}
        onCancel={cancelNameDialog}
      />
    </main>
  );
}

/** ① 두 손 카드 아래 페달 한 줄(동글 소스만). 점은 두 발이 모두 붙었을 때만 켜진다 */
function PedalRow({ pedal, dongle }: { pedal: { connected: [boolean, boolean]; battery: number | null }; dongle: SetupDongleState }) {
  const v = pedalStatus(pedal);
  return (
    <div className="setup-dongle setup-pedal">
      <span className={`stick-dot ${v.dot}`} />
      <span className="setup-dongle-text">{pedalSetupLine(pedal, dongle)}</span>
    </div>
  );
}

/** ① 본문 동글 줄: 포트가 안 열렸으면 [동글 연결], 열렸으면 상태 + [다른 동글 연결]. 클릭 안에서 포트 선택 창을 연다 */
function DongleRow({ state, connected, busy }: { state: SetupDongleState; connected: [boolean, boolean]; busy: boolean }) {
  const line = dongleLine(state, connected);
  const onClick = () => void connectSensor();
  return (
    <div className="setup-dongle">
      {line.dot === null ? (
        <Button variant="primary" onClick={onClick} disabled={busy}>
          {line.action}
        </Button>
      ) : (
        <span className={`stick-dot ${line.dot}`} />
      )}
      <span className={`setup-dongle-text ${line.dot === null ? 'dim' : ''}`}>{line.text}</span>
      {line.dot !== null && (
        <Button variant="text" onClick={onClick} disabled={busy}>
          {line.action}
        </Button>
      )}
    </div>
  );
}
