// 스틱 연결 필요 판정(순수 함수). 자유 연습 빈 상태·끊김 띠가 쓴다.
// Dock 프리셋 칩(dockPresetChipView)은 11/04 Dock에서 칩을 빼며 함께 지웠다.
import type { SensorId } from '@/domain/events';

/**
 * 스틱 연결이 필요한 센서인가.
 * 'none'(키보드 전용)과 연결 개념이 없는 소스(포인터 모의 IMU처럼 usageGuide를 가진 소스)는 필요 없다.
 */
export function stickConnectionRequired(sensorKind: SensorId, hasUsageGuide: boolean): boolean {
  return sensorKind !== 'none' && !hasUsageGuide;
}
