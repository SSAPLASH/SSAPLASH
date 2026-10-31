// Dock 프리셋 칩 표시 판정(순수 함수). Figma 228:5881 Dock — 스틱 연결이 필요한데 한 손이라도 끊기면 「준비 필요」.
// 자유 연습 빈 상태·끊김 띠 판정도 stickConnectionRequired를 같이 쓴다.
import type { SensorId } from './events';

/**
 * 스틱 연결이 필요한 센서인가.
 * 'none'(키보드 전용)과 연결 개념이 없는 소스(포인터 모의 IMU처럼 usageGuide를 가진 소스)는 필요 없다.
 */
export function stickConnectionRequired(sensorKind: SensorId, hasUsageGuide: boolean): boolean {
  return sensorKind !== 'none' && !hasUsageGuide;
}

export type DockPresetChipView =
  | { kind: 'name'; label: string }
  /** hands = [왼손, 오른손] 연결 여부 */
  | { kind: 'needsReady'; label: string; hands: [boolean, boolean] };

export const DOCK_NEEDS_READY_LABEL = '준비 필요';

export function dockPresetChipView(input: {
  sensorKind: SensorId;
  hasUsageGuide: boolean;
  connected: [boolean, boolean];
  presetName: string;
}): DockPresetChipView {
  const { sensorKind, hasUsageGuide, connected, presetName } = input;
  if (stickConnectionRequired(sensorKind, hasUsageGuide) && (!connected[0] || !connected[1])) {
    return { kind: 'needsReady', label: DOCK_NEEDS_READY_LABEL, hands: [connected[0], connected[1]] };
  }
  return { kind: 'name', label: presetName };
}
