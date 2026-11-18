// 준비 조건 판정(순수 함수). 홈·자유 연주·곡 시작 확인 창·설정 페이지가 같은 규칙을 쓴다.
// 키보드 전용(sensorKind === 'none')은 면제한다(설계 D11).
import type { SensorId } from '@/domain/events';
import { DEVICE_META } from './devices';
import { pedalRequired } from './pedalStatus';

// 프리셋 조건은 없다: 시스템 기본이 항상 적용 가능해 "적용된 프리셋 없음" 상태가 없다(UX-64 D1).
export type ReadinessMissing = 'stick' | 'pedal' | 'firstSetup';

export interface ReadinessInput {
  sensorKind: SensorId;
  connected: [boolean, boolean];
  /** [왼발, 오른발] 페달 연결. 동글(webserial) 소스는 두 발 모두 붙어야 한다(PLAY-002 D3). 다른 소스는 보지 않는다 */
  pedal: [boolean, boolean];
  /** 최초 설정 완료 여부. 센서 모드에서는 calibrationReady(적용 프리셋 기준)를 넘긴다(PLAY-004 4-3, UX-64 D7) */
  firstSetupDone: boolean;
}

export interface ReadinessResult {
  ready: boolean;
  missing: ReadinessMissing[];
}

export const READINESS_MESSAGES: Record<ReadinessMissing, string> = {
  stick: '스틱을 연결해 주세요', // 일반형. 빠진 손을 짚으려면 stickMissingText
  pedal: `${DEVICE_META.PEDAL.name}을 연결해 주세요`,
  firstSetup: '최초 설정(드럼 위치 보정)이 필요합니다',
};

/** 빠진 손을 짚는 스틱 안내 문구. 둘 다 연결돼 있으면(호출 실수) 일반형 */
export function stickMissingText(connected: [boolean, boolean]): string {
  const { LEFT, RIGHT } = DEVICE_META;
  if (!connected[0] && !connected[1]) return `${LEFT.name}·${RIGHT.name} 스틱을 연결해 주세요`;
  if (!connected[0]) return `${LEFT.name} 스틱을 연결해 주세요`;
  if (!connected[1]) return `${RIGHT.name} 스틱을 연결해 주세요`;
  return READINESS_MESSAGES.stick;
}

/**
 * 연결된 손마다 앵커가 있는가(PLAY-004 D9). 연결된 손이 없으면 어느 손이든 앵커가 하나라도 있어야 한다.
 * 한 손만 보정한 채 다른 손이 붙으면 false가 되어 ②가 "보정 필요"로 돌아간다
 */
export function anchorsReady(connected: readonly [boolean, boolean], hasAnchors: readonly [boolean, boolean]): boolean {
  const any = connected[0] || connected[1];
  if (!any) return hasAnchors[0] || hasAnchors[1];
  return ([0, 1] as const).every((i) => !connected[i] || hasAnchors[i]);
}

export function readiness(input: ReadinessInput): ReadinessResult {
  if (input.sensorKind === 'none') return { ready: true, missing: [] };
  const missing: ReadinessMissing[] = [];
  // 왼손·오른손 중 하나라도 끊기면 빠진 조건(U7)
  if (!input.connected[0] || !input.connected[1]) missing.push('stick');
  // 동글 소스에서 왼발·오른발 중 하나라도 끊기면 빠진 조건(D3). 손과 별개로 판정해 둘 다 빠지면 둘 다 담는다
  if (pedalRequired(input.sensorKind) && (!input.pedal[0] || !input.pedal[1])) missing.push('pedal');
  if (!input.firstSetupDone) missing.push('firstSetup');
  return { ready: missing.length === 0, missing };
}

/**
 * 적용 프리셋 기준 보정 완료(UX-64 D7). 시스템 기본은 모델 앵커로 판정하므로 재정렬만 없으면 완료,
 * 사용자 프리셋은 연결된 손마다 앵커가 있고(anchorsReady) 재정렬이 필요한 손이 없어야 한다
 */
export function calibrationReady(input: {
  systemPreset: boolean;
  connected: readonly [boolean, boolean];
  hasAnchors: readonly [boolean, boolean];
  realignNeeded?: readonly [boolean, boolean];
}): boolean {
  const r = input.realignNeeded ?? [false, false];
  if (r[0] || r[1]) return false;
  return input.systemPreset || anchorsReady(input.connected, input.hasAnchors);
}
