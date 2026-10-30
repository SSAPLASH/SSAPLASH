// 드럼 세팅 단계 판정·복귀 띠 문구(순수 함수). 판정은 readiness()의 missing에서 유도해 규칙을 중복하지 않는다.
import { PRESET_NAME_MAX, type PresetNameError } from './preset';
import { READINESS_MESSAGES, readiness, stickMissingText, type ReadinessInput, type ReadinessMissing } from './readiness';

export type SetupStepId = 'stick' | 'calibration' | 'preset';
/** skipped = 키보드 전용이라 필요 없음 */
export type SetupStepStatus = 'done' | 'needed' | 'skipped';

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
  /** 이 세션의 시작 위치 보정 시각(ms). 없으면 null */
  referenceSetAt: number | null;
  activePresetName: string | null;
  /** [왼손, 오른손] 배터리 %. null = 알 수 없음. 값을 안 넘기면 요약에 배터리를 붙이지 않는다 */
  battery?: [number | null, number | null];
}

// ---- 문구 상수 ----

/** 하단 바: 저장하지 않은 변경이 있을 때(U4) */
export const SETUP_BAR_DIRTY_TEXT = '저장하지 않은 변경 사항이 있어요 · 저장하지 않고 나가면 원래대로 돌아가요';
/** 하단 바: 적용 프리셋이 없을 때(되돌릴 기준이 없어 편집값은 그대로 남는다, U1) */
export const SETUP_BAR_NO_PRESET_TEXT = '아직 프리셋으로 저장하지 않았어요 · 저장하면 다음에도 이 배치를 쓸 수 있어요';
/** 하단 바: 변경이 없을 때 */
export function setupBarCleanText(presetName: string): string {
  return `「${presetName}」 사용 중`;
}

/** 이탈 확인 문구: 적용 프리셋이 있을 때(4-4) */
export function unsavedLeaveText(presetName: string | null): string {
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

/** 복귀 버튼 문구: 연주 준비 화면이면 고정 문구, 그 밖은 "{이름}으로 돌아가기" */
export function returnButtonText(returnTo: string, returnLabel?: string | null): string {
  const pathname = pathnameOf(returnTo);
  if (matchesPath(pathname, '/play') || matchesPath(pathname, '/sheet')) return '연주 준비로 돌아가기';
  const name = returnTargetName(returnTo, returnLabel);
  return `${name}${josaEuroRo(name)} 돌아가기`;
}

// ---- 단계 판정 ----

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
  if (done) {
    const base = '왼손·오른손 연결됨';
    // 배터리를 하나도 모르면(포인터 소스·STATUS 전) 배터리 부분을 빼고 한 줄로
    const b = input.battery;
    return b && (b[0] !== null || b[1] !== null) ? `${base} · ${pct(b[0])} / ${pct(b[1])}` : base;
  }
  if (l) return '왼손만 연결됨';
  if (r) return '오른손만 연결됨';
  return '연결된 스틱이 없어요';
}

export function setupSteps(input: SetupStepsInput, now: number): SetupStepsResult {
  const keyboardOnly = input.sensorKind === 'none';
  // 키보드 전용은 readiness가 항상 통과라 프리셋만 따로 본다
  const missing = keyboardOnly ? [] : readiness(input).missing;
  const presetNeeded = keyboardOnly ? input.activePresetId === null : missing.includes('preset');

  const skippedSummary = '키보드만 사용해 필요 없어요';
  const steps: SetupStep[] = [];

  if (keyboardOnly) {
    steps.push({ id: 'stick', status: 'skipped', summary: skippedSummary });
    steps.push({ id: 'calibration', status: 'skipped', summary: skippedSummary });
  } else {
    const stickNeeded = missing.includes('stick');
    steps.push({ id: 'stick', status: stickNeeded ? 'needed' : 'done', summary: stickSummary(input, !stickNeeded) });
    const calNeeded = missing.includes('firstSetup');
    steps.push({
      id: 'calibration',
      status: calNeeded ? 'needed' : 'done',
      summary: calNeeded
        ? '시작 위치를 아직 맞추지 않았어요'
        : input.referenceSetAt !== null
          ? `${calibrationTime(input.referenceSetAt, now)}에 보정했어요`
          : '보정했어요',
    });
  }
  steps.push({
    id: 'preset',
    status: presetNeeded ? 'needed' : 'done',
    summary: presetNeeded || input.activePresetName === null ? '사용할 프리셋을 적용하세요' : `「${input.activePresetName}」 사용 중`,
  });

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
