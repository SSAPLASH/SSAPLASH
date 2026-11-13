// 스틱 로컬 진동 모드 (PLAY-006). 모드는 둘뿐이다.
//  - local: 스틱이 타격 즉시 직접 진동한다(기본, 자유 연습). hapticEnable = 1
//  - judgement: 곡 연주 중. 로컬 진동을 끄고(hapticEnable = 0) FE 판정 결과로만 진동한다
// 모드가 바뀔 때와 손이 새로 붙을 때마다 현재 모드 값을 보내, 스틱 상태가 항상 FE 모드를 따라가게 한다.
import { inputManager } from '@/runtime/sources';
import type { StickId } from '@/domain/events';
import type { PlayHaptic } from '@/store/settingsStore';

export type HapticMode = 'local' | 'judgement';

let mode: HapticMode = 'local';
/** 판정 모드 진입 횟수. StrictMode 이중 마운트나 두 화면이 겹쳐도 마지막 이탈 때만 local로 돌아간다 */
let depth = 0;

/**
 * 그 판의 타격 진동 방식(PLAY-006). 방식 스위치는 모니터 빌드에만 있으므로, 모니터 빌드가 아니면 저장값과 무관하게 판정 진동이다.
 * 빌드 스위치는 호출 때 읽는다(테스트가 vi.stubEnv로 바꿀 수 있다). 저장값 자체는 건드리지 않는다
 */
export function effectivePlayHaptic(setting: PlayHaptic): PlayHaptic {
  return import.meta.env.VITE_MONITOR === 'true' ? setting : 'judgement';
}

export function currentHapticMode(): HapticMode {
  return mode;
}

function apply(next: HapticMode): void {
  if (next === mode) return;
  mode = next;
  inputManager.setLocalHaptic(mode === 'local');
}

/** 연주 단계 진입: 붙은 손 전부의 로컬 진동을 끈다 */
export function enterJudgementHaptic(): void {
  depth += 1;
  apply('judgement');
}

/** 연주 단계 이탈: 진입 횟수가 0이 되면 로컬 진동을 다시 켠다 */
export function leaveJudgementHaptic(): void {
  depth = Math.max(0, depth - 1);
  if (depth === 0) apply('local');
}

/** 손이 새로 붙었거나 설정 전(비트 5)일 때: 그 손에만 현재 모드 값을 보낸다 */
export function onStickLinked(stickId: StickId): void {
  inputManager.setLocalHaptic(mode === 'local', stickId);
}

/** 탭을 닫거나 새로고침할 때 local(1)을 보내 본다(최선). 못 보내도 다음 연결 때 local 값이 나간다 */
function onPageHide(): void {
  if (mode !== 'local') inputManager.setLocalHaptic(true);
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);

/** 테스트용: 모드와 진입 횟수를 초기 상태로 되돌린다(전송 없음) */
export function resetHapticModeForTest(): void {
  mode = 'local';
  depth = 0;
}

/** 테스트용: pagehide 핸들러 본체 */
export const pageHideForTest = onPageHide;
