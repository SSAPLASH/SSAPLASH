// 자유 연습 화면 상태 판정(순수 함수). 센서가 선택됐는데 스틱이 연결돼 있는지에 따라 화면이 갈린다(설계 4-4).
// - ready: 그대로 연주
// - empty: 센서 선택 + 양손 미연결 → 캔버스 위 빈 상태 카드
// - oneHand: 한 손만 연결 → 끊김 띠(연주는 계속)
// 스틱 연결이 필요 없는 소스(키보드 전용·포인터 모의 IMU)는 항상 ready — Dock 칩과 같은 규칙(stickConnectionRequired).
import { stickConnectionRequired } from '@/domain/kit/device/dockChip';
import type { SensorId } from '@/domain/events';

export type FreeStage = 'ready' | 'empty' | 'oneHand';

export interface FreeStageInput {
  sensorKind: SensorId;
  /** 선택한 소스 디스크립터에 usageGuide가 있는지(있으면 연결 개념이 없는 소스) */
  hasUsageGuide: boolean;
  connected: [boolean, boolean];
}

export function freeStage({ sensorKind, hasUsageGuide, connected }: FreeStageInput): FreeStage {
  if (!stickConnectionRequired(sensorKind, hasUsageGuide)) return 'ready';
  if (!connected[0] && !connected[1]) return 'empty';
  if (!connected[0] || !connected[1]) return 'oneHand';
  return 'ready';
}
