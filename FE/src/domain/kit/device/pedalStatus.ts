// 페달 연결 판정·표시 문구 순수 함수(스토어를 모른다). 손 쪽은 domain/kit/stickStatus가 맡고, 페달 조각은 여기서 따로 만들어 컴포넌트가 나란히 쓴다.
import { CONNECTED_TEXT, DEVICE_META, DISCONNECTED_TEXT } from './devices';
import type { SetupDongleState } from '@/domain/kit/calibration/setupSteps';

/** 페달 보드가 필요한 두 발(하이햇·킥)이 모두 붙었는지. 준비 조건·재연결 settle·일시정지가 쓰는 한 식 */
export function pedalConnected(pedal: { connected: readonly [boolean, boolean] }): boolean {
  return pedal.connected[0] && pedal.connected[1];
}

/**
 * 이 센서 소스에서 페달이 필수 기기인지(PLAY-002 D3). 페달 보드는 동글(webserial)로만 붙으므로
 * 포인터·BLE·WebSocket 소스는 페달이 올 수 없어 요구하지 않는다. 키보드 전용('none')도 아니다.
 */
export function pedalRequired(sensorKind: string): boolean {
  return sensorKind === 'webserial';
}

/** 준비·복귀에 필요한 기기가 다 붙었는지: 양손 + (동글이면) 두 발 */
export function devicesReady(
  sensorKind: string,
  connected: readonly [boolean, boolean],
  pedal: { connected: readonly [boolean, boolean] },
): boolean {
  return connected[0] && connected[1] && (!pedalRequired(sensorKind) || pedalConnected(pedal));
}

/** 표시에 쓰는 페달 상태(liveStore.pedal의 부분) */
export interface PedalView {
  connected: readonly [boolean, boolean];
  battery: number | null;
}

export interface PedalStatusView {
  /** 두 발이 모두 붙었을 때만 on(보드 하나라 둘은 같이 오르내린다) */
  dot: 'on' | 'off';
  /** "82%". 배터리를 모르거나 끊겼으면 null */
  batteryText: string | null;
  /** 한 줄 문구. 예: "페달 연결됨 · 82%" */
  text: string;
}

/** 셸 칩·세팅 카드가 쓰는 페달 점·문구 */
export function pedalStatus(pedal: PedalView): PedalStatusView {
  const on = pedalConnected(pedal);
  const known = pedal.battery !== null && Number.isFinite(pedal.battery);
  const batteryText = known ? `${Math.round(Math.min(100, Math.max(0, pedal.battery as number)))}%` : null;
  const name = DEVICE_META.PEDAL.name;
  const text = on ? (batteryText ? `${name} ${CONNECTED_TEXT} · ${batteryText}` : `${name} ${CONNECTED_TEXT}`) : `${name} ${DISCONNECTED_TEXT}`;
  return { dot: on ? 'on' : 'off', batteryText: on ? batteryText : null, text };
}

/**
 * 세팅 ① 카드 아래 페달 한 줄. 끊김일 때 동글 포트가 열려 있으면 재탐색 안내를 붙인다
 * (동글이 첫 기기 뒤 10초만 탐색하는 EMB 제약). 포트가 닫혀 있으면 동글 줄이 먼저 안내하므로 뒷문장을 뺀다.
 */
export function pedalSetupLine(pedal: PedalView, dongle: SetupDongleState | undefined): string {
  const v = pedalStatus(pedal);
  if (v.dot === 'on') return v.text;
  return dongle === 'closed' ? v.text : `${v.text} · 페달을 켰다면 동글을 다시 꽂아 주세요`;
}
