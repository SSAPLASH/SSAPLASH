// 드럼 세팅 단계 판정·복귀 띠 문구(순수 함수). 판정은 readiness()의 missing에서 유도해 규칙을 중복하지 않는다.
import { deviceListText } from '@/domain/kit/device/devices';
import { pedalConnected, pedalRequired } from '@/domain/kit/device/pedalStatus';
import { PRESET_NAME_MAX, type PresetNameError } from '@/domain/kit/preset';
import { READINESS_MESSAGES, readiness, stickMissingText, type ReadinessInput, type ReadinessMissing } from '@/domain/kit/device/readiness';

/** 단계는 둘(UX-64): ③ 프리셋은 드럼 배치 카드의 칩 줄로 합쳐졌다 */
export type SetupStepId = 'stick' | 'calibration';
/** skipped = 키보드 전용이라 필요 없음 */
export type SetupStepStatus = 'done' | 'needed' | 'skipped';

/**
 * 동글 상태(Web Serial만). closed: 포트가 안 열림, waiting: 열렸고 LINK 전(예전 동글 펌웨어 포함),
 * ok: LINK 수신 중, stale: LINK가 끊김
 */
export type SetupDongleState = 'closed' | 'waiting' | 'ok' | 'stale';

/** 스틱이 꺼져 있을 때 안내. 스틱은 켜지면 동글에 자동으로 붙는다(EMB 회신) */
export const STICK_POWER_HINT = '스틱 버튼을 눌러 켜 주세요';

export interface DongleLine {
  /** 점 색. 없으면 점을 그리지 않는다(포트가 안 열림) */
  dot: 'on' | 'off' | null;
  text: string;
  /** 버튼: 포트가 안 열렸으면 [동글 연결], 열렸으면 [다른 동글 연결] */
  action: '동글 연결' | '다른 동글 연결';
}

/** ① 본문의 동글 한 줄(Figma 264:8805·264:8855) */
export function dongleLine(dongle: SetupDongleState, connected: readonly [boolean, boolean]): DongleLine {
  if (dongle === 'closed') return { dot: null, text: '처음 한 번만 동글이 꽂힌 포트를 골라요', action: '동글 연결' };
  if (dongle === 'stale') return { dot: 'off', text: '동글 응답이 없어요 · 동글을 다시 꽂아 주세요', action: '다른 동글 연결' };
  const none = !connected[0] && !connected[1];
  return {
    dot: 'on',
    text: none ? `동글이 연결됐어요 · ${STICK_POWER_HINT}` : '동글이 연결됐어요',
    action: '다른 동글 연결',
  };
}

export interface SetupStep {
  id: SetupStepId;
  status: SetupStepStatus;
  summary: string;
}

export interface SetupStepsResult {
  steps: SetupStep[];
  doneCount: number;
  /** skipped를 뺀 단계 수 */
  total: number;
  firstNeeded: SetupStepId | null;
}

export interface SetupStepsInput extends ReadinessInput {
  /** 마지막 보정·재정렬 시각(ms). 없으면 null */
  referenceSetAt: number | null;
  /** 재정렬이 필요한 손(스틱이 다시 켜졌거나 버튼 보정을 받음). 없으면 [false, false]로 본다 */
  realignNeeded?: [boolean, boolean];
  /** 시스템 기본 프리셋 적용 중(UX-64 D7): 보정 없이 모델 앵커로 판정하므로 ② 완료 요약이 다르다 */
  systemPreset?: boolean;
  /** [왼손, 오른손] 배터리 %. null = 알 수 없음. 값을 안 넘기면 요약에 배터리를 붙이지 않는다 */
  battery?: [number | null, number | null];
  /** 동글 상태. 동글 소스(Web Serial)가 아니면 넘기지 않는다 */
  dongle?: SetupDongleState;
}

// ---- 문구 상수 ----

/** 하단 바: 나가려는데 저장하지 않은 변경이 있을 때(복귀 버튼·메뉴 이동, 4-5절 빨강) */
export const SETUP_BAR_DIRTY_TEXT = '저장하지 않은 변경 사항이 있어요 · 저장하지 않고 나가면 원래대로 돌아가요';
/** 하단 바: 적용 프리셋이 없을 때(되돌릴 기준이 없어 편집값은 그대로 남는다, U1) */
export const SETUP_BAR_NO_PRESET_TEXT = '아직 프리셋으로 저장하지 않았어요';
/** 하단 바: 변경이 없을 때 */
export function setupBarCleanText(presetName: string): string {
  return `「${presetName}」 사용 중`;
}
/** 하단 바: 시스템 기본을 끌어 옮겼을 때(노랑 점). 시스템 기본은 고정이라 새 프리셋으로만 남긴다(kit-drag D10) */
export const SETUP_BAR_SYSTEM_CHANGED_TEXT = '시스템 기본은 바꿀 수 없어요 · 새 프리셋으로 저장해야 남아요';
/** 이탈 확인: 시스템 기본을 끌어 옮긴 채 나갈 때(D11) */
export const UNSAVED_LEAVE_SYSTEM_TEXT = '시스템 기본은 바꿀 수 없어요. 새 프리셋으로 저장하지 않고 나가면 옮긴 배치가 사라져요.';
/** 이탈 확인: 시스템 기본일 때 저장 버튼 이름 */
export const UNSAVED_LEAVE_SYSTEM_SAVE_LABEL = '새 프리셋으로 저장하고 나가기';
/** 하단 바: 변경이 있을 때(노랑 점) */
export function setupBarChangedText(presetName: string): string {
  return `「${presetName}」 변경 있음 · 저장하지 않으면 다음에 사라져요`;
}

/** 하단 바 4상태(설계 4-5). tone: caption = 보조 글자색, changed = 노랑 점, leaving = 빨강 */
export type SetupBarTone = 'caption' | 'changed' | 'leaving';
export interface SetupBarView {
  text: string;
  tone: SetupBarTone;
  /** 오른쪽 버튼: save = [저장], saveNew = [새 프리셋으로 저장] */
  button: 'save' | 'saveNew';
  /** 버튼 활성(저장 중 잠금은 호출자가 따로 건다) */
  buttonEnabled: boolean;
}

/** 보정 중 하단 바 입력(UX-64). target 'new' = 추가하기(새 프리셋), 'active' = 적용 프리셋 편집. index는 0부터(세션 스냅샷 그대로) */
export interface SetupBarCalibrating {
  target: 'new' | 'active';
  index: number;
  total: number;
}

/** 하단 바: 보정 중 문구. 「새 프리셋 보정 중 · 7개 중 1번째」 / 「「내 배치」 보정 중 · 7개 중 3번째」 */
export function setupBarCalibratingText(c: SetupBarCalibrating, presetName: string | null): string {
  const head = c.target === 'new' || presetName === null ? '새 프리셋 보정 중' : `「${presetName}」 보정 중`;
  return `${head} · ${c.total}개 중 ${c.index + 1}번째`;
}

/** 하단 바: 추가하기 보정을 마치고 초안을 들고 있을 때(Figma ④·⑤). slot = 고른 빈 슬롯 번호(아직 안 골랐으면 null) */
export function setupBarDraftText(slot: number | null): string {
  return slot === null ? '보정 완료 · 빈 슬롯을 눌러 저장해요' : `보정 완료 · 슬롯 ${slot}에 저장할 이름을 정해요`;
}

/**
 * 하단 바 상태. leaving = 변경이 있는 채로 나가려 해서 이탈 확인이 열려 있다.
 * calibrating이 있으면 보정 중 문구에 [저장] 비활성, draft가 있으면 저장 안내에 [저장] 비활성(UX-64).
 * system = 적용 중이 시스템 기본. dirty(끌어 옮김)면 [새 프리셋으로 저장]을 낸다. full = 프리셋 슬롯이 가득 참(새 프리셋 저장 불가)
 */
export function setupBarView(input: {
  activePresetName: string | null;
  dirty: boolean;
  leaving: boolean;
  system: boolean;
  /** 슬롯이 가득 차 새 프리셋을 못 만든다(시스템 기본 저장 버튼만 막는다) */
  full?: boolean;
  calibrating?: SetupBarCalibrating | null;
  /** 초안을 들고 슬롯·이름 창이 열린 동안. slot은 고른 슬롯 번호 */
  draft?: { slot: number | null } | null;
}): SetupBarView {
  const { activePresetName, dirty, leaving, system, full = false, calibrating, draft } = input;
  if (calibrating) {
    return { text: setupBarCalibratingText(calibrating, activePresetName), tone: 'caption', button: 'save', buttonEnabled: false };
  }
  if (draft) return { text: setupBarDraftText(draft.slot), tone: 'caption', button: 'save', buttonEnabled: false };
  if (system && dirty) {
    return leaving
      ? { text: SETUP_BAR_DIRTY_TEXT, tone: 'leaving', button: 'saveNew', buttonEnabled: !full }
      : { text: SETUP_BAR_SYSTEM_CHANGED_TEXT, tone: 'changed', button: 'saveNew', buttonEnabled: !full };
  }
  if (dirty && leaving) {
    return { text: SETUP_BAR_DIRTY_TEXT, tone: 'leaving', button: activePresetName === null ? 'saveNew' : 'save', buttonEnabled: true };
  }
  if (activePresetName === null) return { text: SETUP_BAR_NO_PRESET_TEXT, tone: 'caption', button: 'saveNew', buttonEnabled: true };
  if (dirty) return { text: setupBarChangedText(activePresetName), tone: 'changed', button: 'save', buttonEnabled: true };
  return { text: setupBarCleanText(activePresetName), tone: 'caption', button: 'save', buttonEnabled: false };
}

/** 이탈 확인 문구: 적용 프리셋이 있을 때(4-4) */
export function unsavedLeaveText(presetName: string | null, system = false): string {
  if (system) return UNSAVED_LEAVE_SYSTEM_TEXT;
  if (presetName === null) return '아직 프리셋으로 저장하지 않았어요. 저장하지 않고 나가면 프리셋으로 남지 않아요.';
  return `「${presetName}」의 패드 위치를 바꿨어요. 저장하지 않고 나가면 바꾼 내용이 사라져요.`;
}

/** 오류 문구. EMPTY는 문구 없이 [저장]만 막는다 */
export const PRESET_NAME_ERROR_TEXT: Record<Exclude<PresetNameError, 'EMPTY'>, string> = {
  TOO_LONG: `${PRESET_NAME_MAX}자까지 입력할 수 있어요`,
  DUPLICATE: '같은 이름의 프리셋이 있어요',
};

// ---- 조사·이름 ----

/** 마지막 글자가 받침 있는 한글인지(한글이 아니면 없음으로 본다) */
function batchim(word: string): 'none' | 'rieul' | 'has' {
  const code = word.trim().charCodeAt(word.trim().length - 1);
  if (code < 0xac00 || code > 0xd7a3) return 'none';
  const jong = (code - 0xac00) % 28;
  if (jong === 0) return 'none';
  return jong === 8 ? 'rieul' : 'has';
}

export function josaEulReul(word: string): string {
  return batchim(word) === 'none' ? '를' : '을';
}

export function josaEunNeun(word: string): string {
  return batchim(word) === 'none' ? '는' : '은';
}

export function josaEuroRo(word: string): string {
  const b = batchim(word);
  return b === 'has' ? '으로' : '로';
}

const RETURN_NAMES: Array<[string, string]> = [
  ['/play', '리듬 게임'],
  ['/sheet', '악보 연습'],
  ['/free', '자유 연습'],
];

function pathnameOf(returnTo: string): string {
  return returnTo.split(/[?#]/)[0] || '/';
}

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** 돌아갈 곳 이름. returnLabel이 있으면 우선, 없으면 경로로 짓는다 */
export function returnTargetName(returnTo: string, returnLabel?: string | null): string {
  if (returnLabel) return returnLabel;
  const pathname = pathnameOf(returnTo);
  if (pathname === '/') return '홈';
  const hit = RETURN_NAMES.find(([base]) => matchesPath(pathname, base));
  return hit ? hit[1] : '이전 화면';
}

/** 복귀 버튼 문구: 리듬 게임·악보 연습 곡 선택(시작 확인 창이 다시 열린다)이면 고정 문구, 그 밖은 "{이름}으로 돌아가기" */
export function returnButtonText(returnTo: string, returnLabel?: string | null): string {
  const pathname = pathnameOf(returnTo);
  if (matchesPath(pathname, '/play') || matchesPath(pathname, '/sheet')) return '곡 선택으로 돌아가기';
  const name = returnTargetName(returnTo, returnLabel);
  return `${name}${josaEuroRo(name)} 돌아가기`;
}

// ---- 단계 판정 ----

/** ② 요약: 적용 프리셋에 연결된 손의 앵커가 없을 때(PLAY-004 4-5). 보정은 드럼 배치 카드에서 한다(UX-64) */
export const CALIBRATION_NEEDED_TEXT = '드럼 위치를 아직 잡지 않았어요 · 드럼 배치에서 보정하세요';
/** ② 요약: 시스템 기본 프리셋은 보정 없이 쓴다(UX-64 D7) */
export const CALIBRATION_SYSTEM_TEXT = '시스템 기본 배치 · 보정 없이 바로 칠 수 있어요';

/** ② 요약: 재정렬이 필요한 손이 있을 때. 없으면 null */
export function realignText(needed: readonly [boolean, boolean] | undefined): string | null {
  if (!needed || (!needed[0] && !needed[1])) return null;
  if (needed[0] && needed[1]) return '스틱이 다시 켜졌어요 · 스네어를 왼손·오른손 한 번씩 쳐 주세요';
  return `${needed[0] ? '왼손' : '오른손'} 스틱이 다시 켜졌어요 · 스네어를 한 번 쳐 주세요`;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

function calibrationTime(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const hhmm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? `오늘 ${hhmm}` : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hhmm}`;
}

function pct(v: number | null): string {
  return v === null ? '–' : `${Math.round(v)}%`;
}

function stickSummary(input: SetupStepsInput, done: boolean): string {
  const [l, r] = input.connected;
  // 페달은 동글 소스만 넣는다(deviceListText의 pedal이 undefined면 뺀다)
  const pedal = pedalRequired(input.sensorKind) ? pedalConnected({ connected: input.pedal }) : undefined;
  if (done) {
    const base = deviceListText({ left: true, right: true, pedal });
    // 배터리를 하나도 모르면(포인터 소스·STATUS 전) 배터리 부분을 빼고 한 줄로. 페달이 빠졌으면 빠진 기기만 말한다
    const b = input.battery;
    return pedal !== false && b && (b[0] !== null || b[1] !== null) ? `${base} · ${pct(b[0])} / ${pct(b[1])}` : base;
  }
  if (l || r) return deviceListText({ left: l, right: r, pedal });
  if (input.dongle === 'closed') return '동글을 연결하면 스틱 상태가 보여요';
  if (input.dongle === 'stale') return '동글 응답이 없어요 · 동글을 다시 꽂아 주세요';
  if (input.dongle !== undefined) return `동글이 연결됐어요 · ${STICK_POWER_HINT}`;
  return '연결된 스틱이 없어요';
}

/**
 * ② 「시작 위치 보정」 요약(UX-64 D7). 재정렬이 필요한 손이 있으면 그 손을 짚는 문구가 우선이고(상태는 needed),
 * 그다음 앵커 없음, 시스템 기본, 보정 시각 순
 */
function calibrationSummary(input: SetupStepsInput, needed: boolean, now: number): string {
  const realign = realignText(input.realignNeeded);
  if (realign) return realign;
  if (needed) return CALIBRATION_NEEDED_TEXT;
  if (input.referenceSetAt !== null) return `${calibrationTime(input.referenceSetAt, now)}에 보정했어요`;
  return input.systemPreset ? CALIBRATION_SYSTEM_TEXT : '보정했어요';
}

export function setupSteps(input: SetupStepsInput, now: number): SetupStepsResult {
  const keyboardOnly = input.sensorKind === 'none';
  const missing = keyboardOnly ? [] : readiness(input).missing;

  const skippedSummary = '키보드만 사용해 필요 없어요';
  const steps: SetupStep[] = [];

  if (keyboardOnly) {
    steps.push({ id: 'stick', status: 'skipped', summary: skippedSummary });
    steps.push({ id: 'calibration', status: 'skipped', summary: skippedSummary });
  } else {
    // 동글 소스는 페달까지 붙어야 ① 연결이 끝난다(타일 이름이 「스틱·페달 연결」, UX-device-naming-unify v0.3)
    const stickNeeded = missing.includes('stick') || missing.includes('pedal');
    steps.push({ id: 'stick', status: stickNeeded ? 'needed' : 'done', summary: stickSummary(input, !stickNeeded) });
    const calNeeded = missing.includes('firstSetup');
    steps.push({ id: 'calibration', status: calNeeded ? 'needed' : 'done', summary: calibrationSummary(input, calNeeded, now) });
  }

  const counted = steps.filter((s) => s.status !== 'skipped');
  return {
    steps,
    doneCount: counted.filter((s) => s.status === 'done').length,
    total: counted.length,
    firstNeeded: steps.find((s) => s.status === 'needed')?.id ?? null,
  };
}

// ---- 복귀 띠 문구 ----

export interface ReturnBannerText {
  title: string;
  line: string;
}

/** 모자란 조건이 있으면 준비 중 문구, 없으면 돌아가기 안내. label은 돌아갈 곳 이름 */
export function returnBannerText(missing: ReadinessMissing[], connected: [boolean, boolean], label: string): ReturnBannerText {
  if (missing.length === 0) {
    return { title: '준비가 끝났어요', line: `${label}${josaEuroRo(label)} 돌아가 바로 시작할 수 있어요 (Enter)` };
  }
  const title = `${label}${josaEulReul(label)} 준비하고 있어요`;
  const oneHand = connected[0] !== connected[1];
  if (missing.length === 1 && missing[0] === 'stick' && oneHand) {
    const hand = connected[0] ? '오른손' : '왼손';
    return { title, line: `${hand} 스틱만 연결하면 돌아갈 수 있어요` };
  }
  const parts = missing.map((m) => (m === 'stick' ? stickMissingText(connected) : READINESS_MESSAGES[m]));
  return { title, line: parts.join(' · ') };
}

/** ② 시작 위치 맞추기(PLAY-004 D6) 문구 */
/** 자세 안내 그림(ReferencePoseGuide)의 제목과 세 줄 안내 */
export const REFERENCE_POSE_TITLE = '편안히 들고 스틱 끝을 모아 주세요';
export const REFERENCE_POSE_STEPS = ['화면을 마주 보고 편하게 앉아요', '두 손을 가까이 모으고 스틱 끝을 맞대요', '버튼을 누르고 3초간 가만히 있어요'] as const;
export const REFERENCE_START_LABEL = '시작 위치 맞추기';
export const REFERENCE_RESTART_LABEL = '다시 맞추기';
export const REFERENCE_HOLDING_TEXT = '3초간 자세를 유지하세요';
export const REFERENCE_SHAKY_TEXT = '자세가 흔들리면 처음부터 다시 셉니다';
export const REFERENCE_LOST_TEXT = '스틱 연결이 끊겨 시작 위치 맞추기를 멈췄어요. 스틱을 다시 연결해 주세요.';
export const REFERENCE_DONE_TEXT = '시작 위치를 맞췄어요';

/** 진행 줄: 「유지 중 1.2초 · 흔들림 0.8°」 */
export function referenceHoldingLine(progress: number, spread: number, holdMs = 3000): string {
  return `유지 중 ${((progress * holdMs) / 1000).toFixed(1)}초 · 흔들림 ${spread.toFixed(1)}°`;
}
