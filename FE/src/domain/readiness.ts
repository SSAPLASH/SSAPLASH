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
  stick: '스틱을 연결하세요',
  firstSetup: '최초 설정(시작 위치 맞추기)이 필요합니다',
  preset: '사용할 프리셋을 적용하세요',
};

export function readiness(input: ReadinessInput): ReadinessResult {
  if (input.sensorKind === 'none') return { ready: true, missing: [] };
  const missing: ReadinessMissing[] = [];
  if (!input.connected[0] && !input.connected[1]) missing.push('stick');
  if (!input.firstSetupDone) missing.push('firstSetup');
  if (input.activePresetId === null) missing.push('preset');
  return { ready: missing.length === 0, missing };
}
