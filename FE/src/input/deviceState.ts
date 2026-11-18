// 기기별 상태. role 0~3 네 칸(왼손·오른손·왼발·오른발)을 두고, 손(0·1)은 status·hit·pose, 발(2·3)은 pedalStatus·hit(foot)·pedal 이벤트로 내보낸다(소스가 한다).
// 시계 보정·SYNC 대기·연결·배터리 보류·"설정 전" 보류는 네 칸 모두 같은 규칙이다.
// 패킷 해석과 이벤트 발행은 하지 않는다(소스가 한다).
import type { DeviceRole } from '@/domain/events';
import { ClockSync } from './source/InputSource';

export type { DeviceRole };

/** SYNC 대기 목록 상한. 답이 없는 기기의 목록이 쌓이지 않게 오래된 것부터 버린다 */
export const MAX_PENDING_SYNC = 16;

export interface DeviceState {
  role: DeviceRole;
  clock: ClockSync;
  /** SYNC 보낸 t0 키 → t0 (ACK에서 지운다) */
  pending: Map<number, number>;
  /** LINK 비트 / 포트·링크 열림·닫힘 */
  linked: boolean;
  /** 아직 안 붙은 기기의 STATUS 배터리를 붙을 때까지 보류 */
  heldBattery: number | undefined;
  /** 아직 안 붙은 기기의 STATUS 비트 5(설정 전)를 붙을 때까지 보류 */
  heldUnconfigured: boolean;
  /** 마지막 시계 초기화 시각(performance.now). 2초 안 중복 초기화 방지 */
  lastClockResetAt: number | null;
}

function createDeviceState(role: DeviceRole): DeviceState {
  return {
    role,
    clock: new ClockSync(),
    pending: new Map(),
    linked: false,
    heldBattery: undefined,
    heldUnconfigured: false,
    lastClockResetAt: null,
  };
}

export function createDeviceStates(): [DeviceState, DeviceState, DeviceState, DeviceState] {
  return [createDeviceState(0), createDeviceState(1), createDeviceState(2), createDeviceState(3)];
}

/** 포트 열기·닫기 때: 시계·대기·보류를 모두 지우고 끊김으로 되돌린다 */
export function resetDevice(state: DeviceState): void {
  state.clock.reset();
  state.pending.clear();
  state.linked = false;
  state.heldBattery = undefined;
  state.heldUnconfigured = false;
  state.lastClockResetAt = null;
}

/**
 * 직전 초기화로부터 minGapMs(기본 2초) 지났거나 처음이면 시계·대기를 초기화하고 true.
 * LINK 0→1과 비트 5 첫 감지가 거의 동시에 오므로 두 번째 신호는 건너뛴다.
 */
export function resetClockIfDue(state: DeviceState, now: number, minGapMs = 2000): boolean {
  if (state.lastClockResetAt !== null && now - state.lastClockResetAt < minGapMs) return false;
  state.clock.reset();
  state.pending.clear();
  state.lastClockResetAt = now;
  return true;
}

/** SYNC 대기 목록에 넣는다. 상한(16)을 넘으면 오래된 것부터 삭제 */
export function addPending(state: DeviceState, key: number, t0: number): void {
  state.pending.set(key, t0);
  while (state.pending.size > MAX_PENDING_SYNC) state.pending.delete(state.pending.keys().next().value!);
}
