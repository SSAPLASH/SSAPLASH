// 통합 설정 페이지(/setup, Figma 03 드럼 세팅, UX-64). 단계 타일 2장(스틱 연결·시작 위치 보정, 요약만 보이고 누르면 단계 팝업 StepDialog가 열린다, PLAY-004 D8) → 드럼 배치 카드(프리셋 칩 줄·캔버스 판(행 전체 폭) 안의 선택 패드 정보 카드·타격 확인, 보정 중에는 하단 바 [저장] 숨김) → 접힌 고급 설정 → 하단 고정 바.
// 프리셋 고르기·고치기·저장은 드럼 배치 카드 한 곳이다: 칩으로 적용, [추가하기]로 패드별 2타 보정 → 새 프리셋 저장, [전체 보정]·[이 드럼 다시 치기]로 적용 프리셋 편집.
// 연주 준비에서 왔으면(returnTo) 위에 복귀 띠를 고정하고, 저장하지 않은 변경이 있으면 나가기 전에 확인한다.
// 단계 판정·문구는 domain/setupSteps, 저장은 presetStore, 보정·재정렬은 runtime/calibrationSession이 맡고
// 이 페이지는 조립과 표시만 한다. 팝업은 진입·재정렬 때 자동으로 열지 않는다(모자란 단계는 타일 강조만, 보정 중에는 ② 팝업을 열 수 없다). 판정은 손별 앵커(stickAnchors, 적용 프리셋의 사본)가 맡고 배치(kitLayout)는 표시 전용이다(PLAY-004 D1·D2).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { KitCanvas } from '@/features/setup/components/KitCanvas';
import { useRecentHits } from '@/components/drum/useRecentHits';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { PageHeader } from '@/components/ui/PageHeader';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { HitLog } from '@/features/setup/components/HitLog';
import { HIT_LOG_ROWS } from '@/features/setup/components/hitLogFormat';
import '@/features/setup/components/setup.css';
import { TimingCalDialog } from '@/components/calibration/TimingCalDialog';
import { timingCalStatusText } from '@/components/calibration/timingCalText';
import { SensorOptionsPanel } from '@/features/setup/components/SensorOptionsPanel';
import { PresetChips, SLOTS_FULL_TEXT } from '@/features/setup/components/PresetChips';
import { PresetNameDialog } from '@/features/setup/components/PresetNameDialog';
import { PresetSlotDialog } from '@/features/setup/components/PresetSlotDialog';
import { ReturnBanner } from '@/features/setup/components/ReturnBanner';
import { StatusTile } from '@/features/setup/components/StatusTile';
import { StepDialog } from '@/features/setup/components/StepDialog';
import { StickCard } from '@/features/setup/components/StickCard';
import { KitInfoOverlay } from '@/features/setup/components/KitInfoOverlay';
import { UnsavedLeaveDialog } from '@/features/setup/components/UnsavedLeaveDialog';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { selectDirty, usePresets } from '@/store/presetStore';
import { PAD_META, STICK_PADS, type PadId } from '@/domain/pads';
import type { StickId } from '@/domain/events';
import { KEY_MAP } from '@/domain/keyMap';
import { anchorsToProfile } from '@/domain/kitJudge';
import { pickOverlayCorner } from '@/domain/kitLayout';
import { defaultHandAnchorSet } from '@/domain/kitModel';
import { padPointCm, padScreenCircles } from '@/domain/kitPerspective';
import { PRESET_SLOTS, isSystemPreset, presetDisplayName, type CaptureDraft, type PresetErrorCode } from '@/domain/preset';
import type { PadTableStatus, YawDriftStatus } from '@/domain/calibration';
import { sanitizeReturnTo } from '@/domain/auth';
import { calibrationReady, readiness } from '@/domain/readiness';
import { deviceGroupName, deviceListText } from '@/domain/devices';
import { pedalConnected, pedalRequired, pedalSetupLine, pedalStatus } from '@/domain/pedalStatus';
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
} from '@/domain/setupSteps';
import { DRIFT_COOLDOWN_MS, DRIFT_MIN_DEG, TUNING_RANGES } from '@/domain/tuning';
import { audioEngine } from '@/audio/AudioEngine';
import { CalibrationStage } from '@/features/setup/components/calibration/CalibrationStage';
import { CAPTURE_GUIDE_TEXT, RESULT_GUIDE_TEXT } from '@/components/calibration/calibrationText';
import { StagePanel } from '@/features/setup/components/StagePanel';
import { useOverlayRegion } from '@/features/setup/components/useOverlayRegion';
import { useRealign } from '@/components/calibration/useRealign';
import { usePoseStream } from '@/features/setup/components/calibration/usePoseStream';
import { ReferencePoseGuide } from '@/features/setup/components/calibration/ReferencePoseGuide';
import { useReferenceCapture } from '@/features/setup/components/calibration/useReferenceCapture';
import { calibrationSession } from '@/runtime/calibrationSession';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { bindSensorSurface, connectSensor } from '@/runtime/sensorSession';
import { setSoundOnHit } from '@/runtime/hitSound';
import { KEYBOARD_INPUT_ENABLED } from '@/runtime/sources';

/** 편집기 표시 크기(Figma 720×320). 위치 값은 이 좌표계의 px로 보여 준다 */
/** 그림 영역을 못 쟀을 때 쓰는 16:10 상자 */
const FALLBACK_FIG = { w: 1600, h: 1000 };

const COUNT_IN_OPTIONS = [
  { value: '0', label: '끔' },
  { value: '1', label: '켬' },
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
  /** 슬롯이 가득 차면 새 프리셋을 못 만든다(추가하기와 같은 규칙, kit-drag D12) */
  const slotsFull = presets.items.length >= PRESET_SLOTS;
  const activePresetName = presetDisplayName(presets.items, s.activePresetId);
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
  // 스테이지 행·캔버스·카드 실제 크기로 가림 영역을 재고 행 높이를 화면에 맞춘다(측정 불가면 고정 비율·CSS 폴백)
  const overlay = useOverlayRegion();
  const [advOpen, setAdvOpen] = useState(false);
  const selectedPlacement = s.kitLayout[selectedPad];
  // 선택 패드의 표시 좌표(cm). 그림에 놓인 3D 점 그대로다(거리는 모델 가정값)
  const selectedPoint = padPointCm(selectedPad, selectedPlacement, s.tuning.angleRange);
  // 보정 전 판정 범위(°): 3D 모델 기본 앵커의 손별 평균. 페달은 없다(null)
  const defaultRadius = useMemo(() => {
    const radii = ([0, 1] as const).map((h) => defaultHandAnchorSet(h, s.tuning)[selectedPad]?.radius).filter((r): r is number => r !== undefined);
    return radii.length ? radii.reduce((a, b) => a + b, 0) / radii.length : null;
  }, [s.tuning, selectedPad]);
  // 정보 카드 자리 고르기용: 원근 그림에서 패드가 차지하는 원
  const padCircles = useMemo(() => padScreenCircles(s.kitLayout, overlay.figSize ?? FALLBACK_FIG, s.tuning.angleRange), [s.kitLayout, overlay.figSize, s.tuning.angleRange]);
  // 선택 패드의 판정 반경(°): 양손 앵커 중 있는 것의 평균. 앵커가 없으면(시스템 기본·미보정) 슬라이더 없음
  const selectedRadius = useMemo(() => {
    const radii = [s.stickAnchors[0]?.[selectedPad]?.radius, s.stickAnchors[1]?.[selectedPad]?.radius].filter((r): r is number => r !== undefined);
    return radii.length ? radii.reduce((a, b) => a + b, 0) / radii.length : null;
  }, [s.stickAnchors, selectedPad]);

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
      </div>

      <div className="timing-cal-row">
        <span className="timing-cal-row-title">박자 맞추기</span>
        <span className={`timing-cal-row-status${s.timingCal ? '' : ' todo'}`}>{timingCalStatusText(s.timingCal, s.audioOffsetMs)}</span>
        <span className="timing-cal-row-help">
          {timingCalBlocked ? '보정 중에는 열 수 없어요' : '클릭 소리에 맞춰 쳐서 판정 타이밍을 자동으로 맞춰요'}
        </span>
        <Button variant="secondary" size="sm" disabled={timingCalBlocked} onClick={() => setTimingCalOpen(true)}>
          {s.timingCal ? '다시 맞추기' : '맞추기'}
        </Button>
      </div>
      {timingCalOpen && <TimingCalDialog onClose={() => setTimingCalOpen(false)} />}

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

      {/* ② 시작 위치 보정(기준 자세·스네어 재정렬, UX-64 D7). 2타 보정은 아래 드럼 배치 카드에서 한다. 보정 중에는 열 수 없다 */}
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
              {calNeeded && !systemPreset && <p className="setup-note">드럼 위치는 아래 드럼 배치 카드에서 [전체 보정] 또는 [추가하기]로 잡아요.</p>}
              {!anyConnected && <p className="setup-note faint">스틱을 연결하면 보정할 수 있습니다.</p>}
            </div>
          )}
        </StepDialog>
      )}

      {/* 드럼 배치 카드: 프리셋 칩 줄 · 배치 편집기(보정 중에는 보정 무대) · 선택 패드 정보 · 타격 확인(준비 조건이 아니라 단계가 아니다) */}
      <Card padding="md" className="setup-kit" role="region" aria-labelledby="setup-kit-title">
        <h2 id="setup-kit-title" className="setup-card-title">
          드럼 배치
        </h2>
        <p className="setup-card-desc">
          {capturing
            ? calibration.capture?.phase === 'done'
              ? RESULT_GUIDE_TEXT
              : CAPTURE_GUIDE_TEXT
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
          onManage={openManage}
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
          <>
            {/* 판(StagePanel, 행 전체 폭) 안쪽 전체에 드럼 그림을 채우고, 정보 카드는 그 위 오른쪽 아래에 겹쳐 놓는다(PLAY-004 D10·D11 v0.3) */}
            {/* 마우스는 고르기만 한다. 소리·타격 기록은 스틱·키보드로만(포인터 모의 IMU의 클릭 타격도 막는다) */}
            <StagePanel
              layout={overlay}
              figClassName="setup-editor"
              noPointerStrike
              action={
                /* 적용 프리셋의 패드 위치를 처음부터 다시 잡는다. 시스템 기본은 고정이라 비활성 */
                sensorMode && (
                  <Button variant="secondary" size="sm" onClick={startFull} disabled={systemPreset || !anyConnected || saving}>
                    전체 보정
                  </Button>
                )
              }
              card={
                /* 선택 패드 카드(편집 상태). 그림과 겹칠 때 패드를 더 가리면 왼쪽 아래로 옮긴다 */
                <KitInfoOverlay
                  cardRef={overlay.cardRef}
                  corner={pickOverlayCorner(padCircles, overlay.region, [selectedPad], overlay.figSize ?? undefined)}
                  name={PAD_META[selectedPad].label}
                  x={String(Math.round(selectedPoint.x))}
                  y={String(Math.round(selectedPoint.y))}
                  z={String(Math.round(selectedPoint.z))}
                  radius={selectedRadius !== null ? `${Math.round(selectedRadius)}°` : defaultRadius !== null ? `${Math.round(defaultRadius)}°` : '–'}
                  // 판정 반경(°) 슬라이더(UX-64 D9): 보정된 패드만. 양손 앵커에 덮어쓰고 스틱 표에도 간다
                  slider={
                    selectedRadius !== null
                      ? {
                          value: selectedRadius,
                          min: s.tuning.minRadiusDeg,
                          max: s.tuning.maxRadiusDeg,
                          disabled: systemPreset,
                          onChange: (v) => s.setRadiusOverride(selectedPad, v),
                        }
                      : null
                  }
                />
              }
            >
              <KitCanvas
                layout={s.kitLayout}
                skin={s.kitSkin}
                onTapPad={setSelectedPad}
                // 보정 중·추가하기 초안이 있을 때만 막는다. 사용자 프리셋은 앵커도 같이 옮기고, 시스템 기본은 배치만 옮겨 새 프리셋으로 저장한다(kit-drag D1·D9)
                draggable={!capturing && !draft}
                onMovePad={(pad, x, y) => {
                  setSelectedPad(pad);
                  s.movePad(pad, x, y);
                }}
                highlightPad={selectedPad}
                keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
                anchorSets={anchorSets}
                angleRange={s.tuning.angleRange}
                poses={pose}
                showPoses={sensorMode}
                posesFromCenter={s.sensorKind === 'pointer'}
                surfaceRef={bindSensorSurface}
              />
            </StagePanel>
            {systemPreset && sensorMode && <p className="setup-note">고정 배치예요. 그 자리를 찾아 치세요. 내 자리로 바꾸려면 [추가하기]로 새 프리셋을 만들어요.</p>}
            <div className="setup-kit-foot">
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
          </>
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
            <p className="setup-card-desc">판정 반경 · 판정 폭 · 노트 낙하 · 카운트다운 · 메트로놈</p>
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
              <span className="setup-adv-label">카운트다운</span>
              <Segmented
                label="카운트다운"
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
          {/* 보정 중에는 하단 바 저장 버튼을 숨긴다: 결과 카드의 [저장]만 남긴다(PLAY-004 D13) */}
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
