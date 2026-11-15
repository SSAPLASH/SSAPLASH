// 통합 설정 페이지(/setup, Figma 03 드럼 세팅, UX-64 · 고정 배치·보정 팝업·느와르 톤 SETUP-fixed-kit-noir). 상태 타일 3장(스틱 연결·시작 위치 보정·박자 맞추기, 요약만 보이고 누르면 단계 팝업 StepDialog가 열린다, PLAY-004 D8) → 「내 드럼」 무대(머리 줄 [다시 보정]·[새로 보정] · 프리셋 칩 줄 · 고정 배치 드럼 그림 · 떠 있는 타격 확인 · 안내 한 줄) → 접힌 고급 설정 → 하단 고정 바.
// 드럼 그림은 언제나 기본 배치다: 프리셋·보정·끌기로 움직이지 않는다(저장·전송하는 kitLayout 값은 그대로 두고 이 화면 그림만 고정, U2). 스틱 끝 점·L/R 표시도 없다. 칠 곳(보정)과 친 곳(타격 확인)에만 불이 들어온다.
// 패드 보정은 팝업(CalibrationDialog)에서 한다: [새로 보정]이 새 프리셋 보정, [다시 보정]이 적용 프리셋 다시 보정이고 저장은 팝업의 [저장]이다. 칩 줄 [프리셋 관리]는 슬롯 창.
// 연주 준비에서 왔으면(returnTo) 위에 복귀 띠를 고정하고, 저장하지 않은 변경이 있으면 나가기 전에 확인한다.
// 단계 판정·문구는 domain/kit/setupSteps, 저장은 presetStore, 보정·재정렬은 runtime/calibrationSession이 맡고
// 이 페이지는 조립과 표시만 한다. 팝업은 진입·재정렬 때 자동으로 열지 않는다(모자란 단계는 타일 강조만, 보정 중에는 ② 팝업을 열 수 없다). 판정은 손별 앵커(stickAnchors, 적용 프리셋의 사본)가 맡고 배치(kitLayout)는 표시 전용이다(PLAY-004 D1·D2).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { LiveDrumKit } from '@/components/drum/LiveDrumKit';
import { KitGuideLabels } from '@/components/drum/KitGuideLabels';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { useRecentHits } from '@/components/drum/useRecentHits';
import { StageBeam, StageFloor } from '@/components/drum/StageLights';
import { Button } from '@/components/ui/action/Button';
import { Card } from '@/components/ui/layout/Card';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { Slider } from '@/components/ui/form/Slider';
import { HitLog } from '@/features/setup/components/HitLog';
import { HIT_LOG_ROWS } from '@/features/setup/components/hitLogFormat';
import '@/features/setup/components/setup.css';
import { TimingCalDialog } from '@/components/calibration/TimingCalDialog';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { outputLatencyWarnText, timingCalMismatchText, timingCalRecordText, timingCalStatusText, timingOffsetText } from '@/components/calibration/timingCalText';
import { kickOffsetOrStick, TIMING_OFFSET_MAX_MS, TIMING_OFFSET_MIN_MS, TIMING_OFFSET_STEP_MS } from '@/domain/kit/calibration/timingCalibration';
import { SensorOptionsPanel } from '@/features/setup/components/SensorOptionsPanel';
import { PresetChips, SLOTS_FULL_TEXT } from '@/features/setup/components/preset/PresetChips';
import { PresetNameDialog } from '@/features/setup/components/preset/PresetNameDialog';
import { PresetSlotDialog } from '@/features/setup/components/preset/PresetSlotDialog';
import { ReturnBanner } from '@/features/setup/components/ReturnBanner';
import { StatusTile } from '@/features/setup/components/StatusTile';
import { StepDialog } from '@/features/setup/components/StepDialog';
import { StickCard } from '@/features/setup/components/StickCard';
import { CalibrationDialog } from '@/features/setup/components/calibration/CalibrationDialog';
import { useStageFit } from '@/features/setup/components/stage/useStageFit';
import { UnsavedLeaveDialog } from '@/features/setup/components/preset/UnsavedLeaveDialog';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { selectDirty, usePresets } from '@/store/presetStore';
import type { StickId } from '@/domain/events';
import { kitGuideLabels } from '@/domain/kit/kitGuide';
import { PRESET_SLOTS, SYSTEM_PRESET_NAME, isSystemPreset, presetDisplayName, type CaptureDraft, type PresetErrorCode } from '@/domain/kit/preset';
import type { PadTableStatus, YawDriftStatus } from '@/domain/kit/calibration/calibration';
import { sanitizeReturnTo } from '@/domain/account/auth';
import { calibrationReady, readiness } from '@/domain/kit/device/readiness';
import { deviceGroupName, deviceListText } from '@/domain/kit/device/devices';
import { pedalConnected, pedalRequired, pedalSetupLine, pedalStatus } from '@/domain/kit/device/pedalStatus';
import {
  dongleLine,
  referenceHoldingLine,
  REFERENCE_DONE_TEXT,
  REFERENCE_HOLDING_TEXT,
  REFERENCE_LOST_TEXT,
  REFERENCE_RESTART_LABEL,
  REFERENCE_SHAKY_TEXT,
  REFERENCE_START_LABEL,
  returnBannerText,
  returnButtonText,
  returnTargetName,
  setupBarView,
  setupSteps,
  unsavedLeaveText,
  UNSAVED_LEAVE_SYSTEM_SAVE_LABEL,
  type SetupDongleState,
  type SetupStepId,
} from '@/domain/kit/calibration/setupSteps';
import { DRIFT_COOLDOWN_MS, DRIFT_MIN_DEG, TUNING_RANGES } from '@/domain/kit/calibration/tuning';
import { audioEngine } from '@/audio/AudioEngine';
import { CalibrationStage } from '@/features/setup/components/calibration/CalibrationStage';
import { useRealign } from '@/components/calibration/useRealign';
import { usePoseStream } from '@/features/setup/components/calibration/usePoseStream';
import { ReferencePoseGuide } from '@/features/setup/components/calibration/ReferencePoseGuide';
import { useReferenceCapture } from '@/features/setup/components/calibration/useReferenceCapture';
import { calibrationSession } from '@/runtime/calibrationSession';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { bindSensorSurface, connectSensor } from '@/runtime/sensorSession';
import { setSoundOnHit } from '@/runtime/hitSound';
import { KEYBOARD_INPUT_ENABLED } from '@/runtime/sources';

/** 킷 최대 배율(자유 연습과 같다). 폭이 좁으면 fitContain이 어차피 폭에 맞춰 줄인다 */
const KIT_SCALE = 1.6;

/** 드럼 그림 아래 안내 한 줄 */
const KIT_GUIDE_TEXT = '아무 패드나 쳐 보세요. 맞게 잡히면 그 자리에 불이 들어와요.';
/** 시스템 기본 + 센서 모드: 고정 자리 안내 */
const KIT_GUIDE_SYSTEM_TEXT = '기본 자리예요. 내 자리로 맞추려면 [새로 보정]을 눌러요.';

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

/** 스틱별 방위각 보정 문구. 보일 게 없으면 null. 쿨다운 경과는 1초 tick 리렌더로 갱신된다. */
function yawDriftText(drift: [YawDriftStatus | null, YawDriftStatus | null], connected: [boolean, boolean]): string | null {
  const names = ['왼손', '오른손'];
  const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`;
  const applied: string[] = [];
  let unconfirmed = false;
  let halted = false;
  let pending: number | null = null;
  drift.forEach((st, i) => {
    if (!st || !connected[i]) return;
    if (st.halted) halted = true;
    if (st.appliedDeg !== 0) {
      applied.push(`${names[i]} ${fmt(st.appliedDeg)}`);
      if (st.acked === false) unconfirmed = true;
    }
    // 멈춘 손은 뒤따르는 보정이 없으므로 그 손의 오차로는 「잠시 뒤 보정」을 알리지 않는다
    const cooling = !st.halted && st.lastSentAt !== null && performance.now() - st.lastSentAt < DRIFT_COOLDOWN_MS;
    if (pending === null && st.lastErrorDeg !== null && Math.abs(st.lastErrorDeg) >= DRIFT_MIN_DEG && cooling) pending = st.lastErrorDeg;
  });
  const parts: string[] = [];
  if (applied.length) parts.push(`방위각 보정 ${applied.join(' · ')}${unconfirmed ? ' (미확인)' : ''}`);
  if (pending !== null) parts.push(`방위각 드리프트 감지(${Math.round(pending)}°) · 잠시 뒤 보정`);
  if (halted) parts.push('자동 보정 멈춤(방향 흔들림)');
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
  // 타격 확인·패드 소리 확인을 위해 이 화면에서도 키보드 드럼을 받는다(입력 칸·대화상자의 키는 소스가 건드리지 않는다)
  useKeyboardDrum(true);
  const s = useSettings();
  const presets = usePresets();
  const connected = useLive((l) => l.connected);
  const pedal = useLive((l) => l.pedal.connected);
  const pedalBattery = useLive((l) => l.pedal.battery);
  const battery = useLive((l) => l.battery);
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
  /** 슬롯이 가득 차면 새 프리셋을 못 만든다(추가하기와 같은 규칙, kit-drag D12) */
  const slotsFull = presets.items.length >= PRESET_SLOTS;
  const activePresetName = presetDisplayName(presets.items, s.activePresetId);
  const stageName = activePresetName ?? SYSTEM_PRESET_NAME;
  const saving = presets.status === 'saving';

  // 진입: 프리셋 목록 읽기, 센서 타격이 바로 울리게. 떠날 때 타격음을 끈다
  useEffect(() => {
    void usePresets.getState().refresh();
    setSoundOnHit(true);
    return () => setSoundOnHit(false);
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

  const hasAnchors: [boolean, boolean] = [s.stickAnchors[0] !== null, s.stickAnchors[1] !== null];

  const lat = audioEngine.latency();
  // 박자 맞추기 안내: 측정한 입력과 지금 입력이 다르거나, 보고된 출력 지연이 크면 고급 설정에 한 줄씩 보인다
  const timingMismatch = timingCalMismatchText(s.timingCal, sensorMode);
  const latencyWarn = outputLatencyWarnText(lat?.outputLatencyMs);
  const recentHits = useRecentHits(HIT_LOG_ROWS);
  // 드럼 그림: 자유 연습과 같은 LiveDrumKit. 패드 점등·타격 모션은 usePadStates·usePadHitSeq가 준다
  const padStates = usePadStates();
  const hitSeq = usePadHitSeq();
  // 키 안내: 실물 스킨은 이름표 알약(키보드 입력이 켜져 있으면 키 글자 포함), 전자·네온은 내장 글자를 쓴다
  const acoustic = s.kitSkin === 'acoustic';
  const guideLabels = useMemo(() => kitGuideLabels(s.kitSkin, KEYBOARD_INPUT_ENABLED), [s.kitSkin]);
  // 무대 높이를 화면에 맞춘다(측정 불가면 CSS 폴백)
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
  useStageFit(stageEl);
  const [advOpen, setAdvOpen] = useState(false);

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

  // ---- 단계 팝업: 사용자가 타일을 눌러야 열린다(진입·재정렬 필요로 자동으로 열지 않는다, PLAY-004 D8) ----
  const [stepDialog, setStepDialog] = useState<SetupStepId | null>(null);

  // ---- 2타 보정(PLAY-004, UX-64). 로직은 calibrationSession, 여기선 시작·다음·저장·취소만 ----
  const capturing = calibration.mode === 'capture';
  // 박자 맞추기(판정 타이밍 자동 보정). 패드 보정·재정렬 중에는 타격을 서로 가로채므로 열지 않는다
  const [timingCalOpen, setTimingCalOpen] = useState(false);
  const timingCalBlocked = calibration.mode !== 'idle';
  const realigning = calibration.mode === 'realign';
  const captureTarget = capturing ? calibration.target : null;
  const stopCapture = () => calibrationSession.cancelCapture();
  const startFull = () => calibrationSession.startCapture({ target: 'active' });
  const startAdd = () => calibrationSession.startCapture({ target: 'new' });
  const calibrating = calibration.capture && captureTarget ? { target: captureTarget, index: calibration.capture.index, total: calibration.capture.order.length } : null;
  // 스틱이 다시 켜진 손이 있으면 재정렬 세션을 자동으로 시작한다(네 진입점 공용 훅)
  useRealign(sensorMode);

  // ---- 시작 위치 맞추기(PLAY-004 D1·D4~D6): 세팅 화면에서만 자세 스트림을 켜고, 연결된 모든 손이 3초 안정되면 기준을 잡는다 ----
  const handsConnected = useMemo<StickId[]>(() => ([0, 1] as StickId[]).filter((i) => connected[i]), [connected]);
  usePoseStream(sensorMode && anyConnected, handsConnected.length);
  const refHold = useReferenceCapture(handsConnected);
  const refHolding = refHold.phase === 'holding';
  const [refLost, setRefLost] = useState(false);
  const refLostWasHolding = useRef(false);
  useEffect(() => {
    // 진행 중 연결이 모두 끊기면 훅이 idle로 돌아간다 — 그때 오류 문구를 띄운다
    if (refLostWasHolding.current && refHold.phase === 'idle' && !anyConnected) setRefLost(true);
    refLostWasHolding.current = refHolding;
  }, [refHold.phase, refHolding, anyConnected]);

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
    presets.clearError();
    setSlotOpen(false);
    setDraft(null);
    setDraftSlot(null);
  };

  /** 칩 줄 [프리셋 관리]: 초안 없이 슬롯 창을 연다(적용·지우기·현재 배치 저장) */
  const openManage = () => {
    presets.clearError();
    setSlotOpen(true);
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
    if (systemPreset || !presets.items.some((p) => p.id === s.activePresetId)) {
      // 시스템 기본이거나 적용 프리셋이 목록에 없다(저장소 전환 직후): 새 프리셋으로 저장
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
  const withPedal = pedalRequired(s.sensorKind);
  const sensorDesc = sensorRegistry.get(s.sensorKind);
  let connText: string;
  if (!sensorMode) connText = '키보드만 사용합니다.';
  else if (sourceState === 'error') connText = `오류: ${sourceMessage ?? '알 수 없음'}`;
  else if (sourceState === 'connecting') connText = '연결 중…';
  else connText = deviceListText({ left: connected[0], right: connected[1], pedal: withPedal ? pedalConnected({ connected: pedal }) : undefined });

  // ---- 상태 타일 공통(Setup / StatusTile): 누르면 단계 팝업을 연다. 보정 중에는 ② 팝업을 열 수 없다 ----
  const openStep = (id: SetupStepId) => setStepDialog(id);
  const closeStep = () => setStepDialog(null);
  /** 타일 버튼 문구: 모자란 단계는 행동 문구, 아니면 [보기] */
  const tileActionText = (id: SetupStepId): string => {
    if (stepOf(id).status !== 'needed') return '보기';
    return id === 'stick' ? '연결하기' : '보정하기';
  };
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
    system: systemPreset,
    full: slotsFull,
    calibrating,
    draft: draft ? { slot: draftSlot } : null,
  });
  const nameDialogError = presets.status === 'error' && presets.error ? ERROR_TEXT[presets.error] : null;
  const showPresetError = presets.status === 'error' && presets.error !== null && nameOpen === null;
  const calNeeded = stepOf('calibration').status === 'needed' && !realigning;
  const hitNotice =
    sensorMode && !anyConnected ? (
      <div className="setup-notice error setup-hit-notice">
        <strong>스틱 연결 끊김</strong>
        <span>연결 상태를 확인해주세요.</span>
      </div>
    ) : null;

  return (
    <main className="main setup-page">
      {/* 느와르 톤: 페이지 전체 빛줄기. 센서 모드는 스틱이 하나라도 연결되면, 키보드 전용은 늘 켠다 */}
      <StageBeam on={sensorMode ? anyConnected : true} />
      {returnTo && (
        <ReturnBanner
          {...returnBannerText(missing, connected, returnTargetName(returnTo, returnLabel))}
          buttonText={returnButtonText(returnTo, returnLabel)}
          ready={ready}
          enterEnabled={!leaveOpen && nameOpen === null && !capturing}
          onReturn={onReturn}
        />
      )}

      <PageHeader
        title="연주 환경 설정"
        actions={
          <span className="setup-progress">
            {stepsResult.total}단계 중 {stepsResult.doneCount}단계 완료
          </span>
        }
      />

      <div className="setup-tiles">
        {/* ① 스틱 연결 */}
        <StatusTile
          id={STEP_DOM_ID.stick}
          title={`${deviceGroupName(withPedal)} 연결`}
          status={stepOf('stick').status}
          statusText={tileStatusText('stick')}
          summary={stepOf('stick').summary}
          actionText={tileActionText('stick')}
          onOpen={() => openStep('stick')}
          urgent={returnTo !== null}
          attention
        />
        <StatusTile
          id={STEP_DOM_ID.calibration}
          title="시작 위치 보정"
          status={stepOf('calibration').status}
          statusText={tileStatusText('calibration')}
          summary={stepOf('calibration').summary}
          actionText={tileActionText('calibration')}
          onOpen={() => openStep('calibration')}
          urgent={returnTo !== null}
          attention
          disabled={capturing}
          reason={capturing ? '보정 중에는 열 수 없어요' : undefined}
        />
        <StatusTile
          id="setup-timing"
          title="박자 맞추기"
          status={s.timingCal ? 'done' : 'needed'}
          statusText={timingCalStatusText(s.timingCal, s.audioOffsetMs, s.kickOffsetMs)}
          statusWarn={!s.timingCal}
          summary="클릭 소리에 맞춰 쳐서 판정 타이밍을 맞춰요"
          actionText={s.timingCal ? '다시 맞추기' : '맞추기'}
          onOpen={() => setTimingCalOpen(true)}
          disabled={timingCalBlocked}
          reason={timingCalBlocked ? '보정 중에는 열 수 없어요' : undefined}
        />
      </div>

      {timingCalOpen && <TimingCalDialog className="setup-timing-dialog" onClose={() => setTimingCalOpen(false)} />}

      {stepDialog === 'stick' && (
        <StepDialog title={`${deviceGroupName(withPedal)} 연결`} titleId="step-dialog-stick" onClose={closeStep}>
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
        </StepDialog>
      )}

      {/* ② 시작 위치 보정(기준 자세·스네어 재정렬, UX-64 D7). 2타 보정은 아래 내 드럼의 보정 팝업에서 한다. 보정 중에는 열 수 없다 */}
      {stepDialog === 'calibration' && !capturing && (
        <StepDialog title="시작 위치 보정" titleId="step-dialog-calibration" onClose={closeStep}>
          {!sensorMode ? (
            <p className="setup-note">키보드 입력은 보정이 필요 없습니다.</p>
          ) : realigning ? (
            <CalibrationStage onRestart={anyConnected && !systemPreset ? startFull : undefined} />
          ) : (
            <div className="setup-col">
              {/* 자세 안내 그림: 처음이든 다시 맞추기든 항상 보인다 */}
              <ReferencePoseGuide
                state={refHolding ? (refHold.progress === 0 && refHold.spread > 3 ? 'shaky' : 'holding') : refHold.phase === 'done' ? 'done' : 'idle'}
              />
              {refHolding ? (
                <>
                  <p className="setup-note" role="status">
                    {REFERENCE_HOLDING_TEXT}
                  </p>
                  <div className="setup-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(refHold.progress * 100)}>
                    <div style={{ width: `${Math.round(refHold.progress * 100)}%` }} />
                  </div>
                  <p className="setup-note faint">
                    {referenceHoldingLine(refHold.progress, refHold.spread)}
                    {refHold.progress === 0 && refHold.spread > 3 ? ` · ${REFERENCE_SHAKY_TEXT}` : ''}
                  </p>
                  <div className="setup-row">
                    <Button variant="secondary" onClick={refHold.cancel}>
                      취소
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {refHold.phase === 'done' && (
                    <p className="setup-note" role="status">
                      {REFERENCE_DONE_TEXT}
                    </p>
                  )}
                  {refLost && !anyConnected && (
                    <p className="setup-notice error" role="alert">
                      {REFERENCE_LOST_TEXT}
                    </p>
                  )}
                  <div className="setup-row">
                    <Button
                      variant={calNeeded && referenceSetAt === null ? 'primary' : 'secondary'}
                      onClick={() => {
                        setRefLost(false);
                        refHold.start();
                      }}
                      disabled={!anyConnected || capturing || realigning}
                    >
                      {referenceSetAt === null && refHold.phase !== 'done' ? REFERENCE_START_LABEL : REFERENCE_RESTART_LABEL}
                    </Button>
                  </div>
                </>
              )}
              {calNeeded && !systemPreset && <p className="setup-note">드럼 위치는 아래 내 드럼에서 [다시 보정] 또는 [새로 보정]으로 잡아요.</p>}
              {!anyConnected && <p className="setup-note faint">스틱을 연결하면 보정할 수 있습니다.</p>}
            </div>
          )}
        </StepDialog>
      )}

      {/* 내 드럼 무대: 머리 줄 · 프리셋 칩 줄 · 고정 배치 드럼 그림 + 떠 있는 타격 확인 · 안내 한 줄(카드 면 없음, 자유 연습 무대와 같은 톤) */}
      <section className="setup-kit" aria-labelledby="setup-kit-title">
        <div className="setup-stage-head">
          <div className="setup-stage-title">
            <h2 id="setup-kit-title">내 드럼</h2>
            <span>프리셋: {stageName} · 8패드</span>
          </div>
          {sensorMode && (
            <div className="setup-stage-actions">
              {/* 적용 프리셋의 패드 위치를 처음부터 다시 잡는다. 시스템 기본은 고정이라 비활성 */}
              <Button variant="secondary" size="sm" onClick={startFull} disabled={systemPreset || !anyConnected || saving}>
                다시 보정
              </Button>
              {/* 새 프리셋으로 처음부터 보정. 슬롯이 가득 차면 비활성 */}
              <Button size="sm" onClick={startAdd} disabled={saving || capturing || !anyConnected || slotsFull} title={slotsFull ? SLOTS_FULL_TEXT : undefined}>
                새로 보정
              </Button>
            </div>
          )}
        </div>
        <PresetChips
          presets={presets.items}
          activeId={s.activePresetId}
          calibratedText={calibratedText(s.calibratedAt, now)}
          sensorMode={sensorMode}
          busy={saving}
          onSelect={(id) => presets.apply(id)}
          onManage={openManage}
        />
        {showPresetError && (
          <div className="setup-notice error setup-row" style={{ justifyContent: 'space-between' }}>
            <span>{ERROR_TEXT[presets.error!]}</span>
            <Button variant="secondary" size="sm" onClick={presets.clearError}>
              닫기
            </Button>
          </div>
        )}
        {/* 무대 컨테이너: 넓으면 타격 확인이 그림 왼쪽 위에 떠 있고, 좁으면 그림 아래로 내려온다(CSS 컨테이너 쿼리) */}
        <div className="setup-kit-stage">
          <div className="setup-kit-zone" ref={setStageEl}>
            {/* 마우스는 칠 수 없다: 소리·타격 기록은 스틱·키보드로만(포인터 모의 IMU의 클릭 타격도 막는다). 센서 면 등록만 한다 */}
            <div ref={bindSensorSurface} className="setup-kit-surface" data-no-pointer-strike="">
              <LiveDrumKit
                fitContain
                effects
                scale={KIT_SCALE}
                states={padStates}
                skin={s.kitSkin}
                hitSeq={hitSeq}
                labels={!acoustic}
                underlay={<StageFloor />}
                overlay={acoustic ? <KitGuideLabels labels={guideLabels} visible /> : undefined}
              />
            </div>
          </div>
          <div className="setup-hit">
            <h3 className="setup-hit-title">타격 확인</h3>
            {hitNotice}
            <HitLog hits={recentHits} now={now} />
          </div>
        </div>
        <p className="setup-kit-guide">{systemPreset && sensorMode ? KIT_GUIDE_SYSTEM_TEXT : KIT_GUIDE_TEXT}</p>
      </section>

      {/* 패드 보정 팝업: 보정 중(capture)에만 열린다. 재정렬은 ② 단계 팝업이 맡는다 */}
      {capturing && <CalibrationDialog presetName={stageName} onSave={onCaptureSave} />}

      {/* 고급 설정: 판정 타이밍·패드 인식 범위. 스틱·기기에 맞추는 값만 둔다(앱 동작 값은 설정 화면). 설정 스토어에 즉시 저장되어 미저장 판정 대상이 아니다 */}
      <Card padding="md" className="setup-adv" role="region" aria-labelledby="setup-adv-title">
        <div className="setup-card-head">
          <div className="setup-step-main">
            <h2 id="setup-adv-title" className="setup-card-title">
              고급 설정
            </h2>
            <p className="setup-card-desc">판정 타이밍 · 패드 인식 범위</p>
          </div>
          <Button variant="text" className="setup-step-action" aria-expanded={advOpen} aria-controls="setup-adv-body" onClick={() => setAdvOpen((v) => !v)}>
            {advOpen ? '접기' : '펼치기'}
          </Button>
        </div>
        {advOpen && (
          <div id="setup-adv-body" className="setup-adv-body">
            <div className="setup-adv-group" role="group" aria-labelledby="setup-adv-timing">
              <h3 id="setup-adv-timing" className="setup-adv-group-title">판정 타이밍</h3>
              <p className="setup-adv-note">박자 맞추기로 자동으로 맞출 수 있어요. 여기서는 손으로 미세하게 고쳐요.</p>
              <Slider
                label="스틱 판정 타이밍"
                min={TIMING_OFFSET_MIN_MS}
                max={TIMING_OFFSET_MAX_MS}
                step={TIMING_OFFSET_STEP_MS}
                value={s.audioOffsetMs}
                valueText={timingOffsetText(s.audioOffsetMs)}
                onChange={s.setAudioOffsetMs}
              />
              <p className="setup-adv-help">판정이 빠르게 나오면 내리고, 늦게 나오면 올리세요</p>
              <Slider
                label="킥 판정 타이밍"
                min={TIMING_OFFSET_MIN_MS}
                max={TIMING_OFFSET_MAX_MS}
                step={TIMING_OFFSET_STEP_MS}
                value={kickOffsetOrStick(s.audioOffsetMs, s.kickOffsetMs)}
                valueText={timingOffsetText(kickOffsetOrStick(s.audioOffsetMs, s.kickOffsetMs))}
                onChange={s.setKickOffsetMs}
              />
              <p className="setup-adv-help">킥 페달 판정만 따로 맞춰요.</p>
              <p className="setup-adv-note">{timingCalRecordText(s.timingCal)}</p>
              {timingMismatch && <p className="setup-adv-note">{timingMismatch}</p>}
              {latencyWarn && <p className="setup-adv-note">{latencyWarn}</p>}
              <p className="setup-adv-foot">
                오디오 지연 실측: {lat ? `base ${lat.baseLatencyMs.toFixed(1)}ms · output ${lat.outputLatencyMs.toFixed(1)}ms · ${lat.sampleRate}Hz` : '소리를 한 번 내면 표시됩니다'}
              </p>
            </div>
            <div className="setup-adv-group" role="group" aria-labelledby="setup-adv-range">
              <h3 id="setup-adv-range" className="setup-adv-group-title">패드 인식 범위</h3>
              <p className="setup-adv-note">패드 보정이 정하는 패드별 인식 범위의 한계예요. 옆 패드가 같이 울리면 최대를 줄이고, 잘 안 맞으면 최소를 늘리세요.</p>
              <Slider
                label="패드 인식 범위 최소"
                min={TUNING_RANGES.minRadiusDeg.min}
                max={TUNING_RANGES.minRadiusDeg.max}
                step={TUNING_RANGES.minRadiusDeg.step}
                value={s.tuning.minRadiusDeg}
                valueText={`${s.tuning.minRadiusDeg}°`}
                onChange={(v) => s.setTuning({ minRadiusDeg: v })}
              />
              <Slider
                label="패드 인식 범위 최대"
                min={TUNING_RANGES.maxRadiusDeg.min}
                max={TUNING_RANGES.maxRadiusDeg.max}
                step={TUNING_RANGES.maxRadiusDeg.step}
                value={s.tuning.maxRadiusDeg}
                valueText={`${s.tuning.maxRadiusDeg}°`}
                onChange={(v) => s.setTuning({ maxRadiusDeg: v })}
              />
            </div>
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
          {/* 보정 중에는 하단 바 저장 버튼을 숨긴다: 팝업 결과 화면의 [저장]만 남긴다(PLAY-004 D13) */}
          {!capturing &&
            (bar.button === 'save' ? (
              <Button className="setup-bar-action" disabled={!bar.buttonEnabled || saving} onClick={onSaveChanges}>
                저장
              </Button>
            ) : (
              <Button
                className="setup-bar-action wide"
                disabled={saving || !bar.buttonEnabled}
                title={systemPreset && slotsFull ? SLOTS_FULL_TEXT : undefined}
                onClick={() => openNameDialog('save')}
              >
                새 프리셋으로 저장
              </Button>
            ))}
        </span>
      </div>

      <UnsavedLeaveDialog
        open={leaveOpen}
        message={unsavedLeaveText(activePresetName, systemPreset)}
        saveLabel={systemPreset ? UNSAVED_LEAVE_SYSTEM_SAVE_LABEL : undefined}
        saveDisabled={systemPreset && slotsFull}
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
        onDelete={(id) => void presets.remove(id)}
        error={slotOpen ? nameDialogError : null}
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
