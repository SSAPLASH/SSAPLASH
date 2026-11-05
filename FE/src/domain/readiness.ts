// 준비 조건 판정(순수 함수). 홈·자유 연주·곡 연주 준비·설정 페이지가 같은 규칙을 쓴다.
// 키보드 전용(sensorKind === 'none')은 면제한다(설계 D11).
import type { SensorId } from './events';
import { pedalRequired } from './pedalStatus';

export type ReadinessMissing = 'stick' | 'pedal' | 'firstSetup' | 'preset';

export interface ReadinessInput {
  sensorKind: SensorId;
  connected: [boolean, boolean];
  /** [왼발, 오른발] 페달 연결. 동글(webserial) 소스는 두 발 모두 붙어야 한다(PLAY-002 D3). 다른 소스는 보지 않는다 */
  pedal: [boolean, boolean];
  /** 최초 설정 완료 여부. 설정 페이지에서는 "이 세션에서 보정했는가"(referenceSetAt !== null)를 넘긴다 */
  firstSetupDone: boolean;
  activePresetId: string | null;
}

export interface ReadinessResult {
  ready: boolean;
  missing: ReadinessMissing[];
}

export const READINESS_MESSAGES: Record<ReadinessMissing, string> = {
  stick: '스틱을 연결하세요', // 일반형. 빠진 손을 짚으려면 stickMissingText
  pedal: '페달을 연결하세요',
  firstSetup: '최초 설정(시작 위치 맞추기)이 필요합니다',
  preset: '사용할 프리셋을 적용하세요',
};

/** 빠진 손을 짚는 스틱 안내 문구. 둘 다 연결돼 있으면(호출 실수) 일반형 */
export function stickMissingText(connected: [boolean, boolean]): string {
  if (!connected[0] && !connected[1]) return '왼손·오른손 스틱을 연결하세요';
  if (!connected[0]) return '왼손 스틱을 연결하세요';
  if (!connected[1]) return '오른손 스틱을 연결하세요';
  return READINESS_MESSAGES.stick;
}

export function readiness(input: ReadinessInput): ReadinessResult {
  if (input.sensorKind === 'none') return { ready: true, missing: [] };
  const missing: ReadinessMissing[] = [];
  // 왼손·오른손 중 하나라도 끊기면 빠진 조건(U7)
  if (!input.connected[0] || !input.connected[1]) missing.push('stick');
  // 동글 소스에서 왼발·오른발 중 하나라도 끊기면 빠진 조건(D3). 손과 별개로 판정해 둘 다 빠지면 둘 다 담는다
  if (pedalRequired(input.sensorKind) && (!input.pedal[0] || !input.pedal[1])) missing.push('pedal');
  if (!input.firstSetupDone) missing.push('firstSetup');
  if (input.activePresetId === null) missing.push('preset');
  return { ready: missing.length === 0, missing };
}
