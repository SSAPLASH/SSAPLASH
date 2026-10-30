// 준비 조건 판정(순수 함수). 홈·자유 연주·곡 연주 준비·설정 페이지가 같은 규칙을 쓴다.
// 키보드 전용(sensorKind === 'none')은 면제한다(설계 D11).
import type { SensorId } from './events';

export type ReadinessMissing = 'stick' | 'firstSetup' | 'preset';

export interface ReadinessInput {
  sensorKind: SensorId;
  connected: [boolean, boolean];
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
  if (!input.firstSetupDone) missing.push('firstSetup');
  if (input.activePresetId === null) missing.push('preset');
  return { ready: missing.length === 0, missing };
}
