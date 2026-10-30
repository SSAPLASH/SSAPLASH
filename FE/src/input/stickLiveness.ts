// 스틱별 무응답 끊김 판정 (U9 임시안).
// 동글 아래 한 손만 떨어지면 포트는 그대로라 끊김 이벤트가 오지 않는다. 그래서 손별 마지막 패킷 수신 시각을 보고
// 일정 시간 아무것도 안 오면 그 손을 끊김으로 본다.
// 주의: 게임 모드(모드 0)에서는 POSE가 오지 않아 연주가 없는 동안엔 패킷이 없다 → 이 판정은 임시다.
// EMB 회신(PLAY-002_스틱-연결-배터리-표시_from_최형수.md: 링크 이벤트 또는 STATUS 하트비트)이 오면
// 이 모듈만 교체한다 (판정은 이 파일 한 곳에 둔다).
import type { StickId } from '@/domain/events';

/**
 * 무응답 판정을 켤지. 지금은 끈다 — FE는 보정 중에만 POSE를 켜고 게임 모드엔 POSE가 없어,
 * 치지 않고 3초만 있어도 양손 끊김 → 자동 일시정지(usePauseTriggers)가 걸린다. EMB 하트비트가 정해지면 켠다
 */
export const STICK_LIVENESS_ENABLED = false;

/** 이 시간(ms) 동안 패킷이 하나도 없으면 그 손을 끊김으로 본다 */
export const STICK_SILENCE_MS = 3000;

/** 패킷 스트림을 실제로 받는 센서 소스. 키보드·포인터(패킷 없이 connected만 보냄)는 해당 없음 */
const PACKET_STREAM_SOURCES: readonly string[] = ['webserial', 'websocket', 'ble'];

export function isPacketStreamSource(kind: string): boolean {
  return PACKET_STREAM_SOURCES.includes(kind);
}

/** 손별 마지막 수신 시각(ms)에서 무응답 끊김이 된 손을 골라 낸다. 추적 중이 아닌 손(null)은 대상이 아니다 */
export function silentSticks(
  lastSeen: readonly [number | null, number | null],
  now: number,
  silenceMs: number = STICK_SILENCE_MS,
): StickId[] {
  const out: StickId[] = [];
  for (const id of [0, 1] as const) {
    const t = lastSeen[id];
    if (t !== null && now - t >= silenceMs) out.push(id);
  }
  return out;
}

/** 손별 마지막 수신 시각 기록. 시계는 호출자가 넘긴다(테스트·타이머 공용) */
export class StickLivenessTracker {
  private lastSeen: [number | null, number | null] = [null, null];

  /** 패킷(HIT·POSE·STATUS)을 받았다 */
  touch(stickId: StickId, now: number): void {
    this.lastSeen[stickId] = now;
  }

  /** 그 손을 더 추적하지 않는다(소스가 끊김을 직접 알렸을 때) */
  clear(stickId: StickId): void {
    this.lastSeen[stickId] = null;
  }

  clearAll(): void {
    this.lastSeen = [null, null];
  }

  /** 새로 무응답이 된 손을 돌려주고 추적을 멈춘다. 다시 패킷이 오면 touch가 추적을 되살린다 */
  expire(now: number, silenceMs: number = STICK_SILENCE_MS): StickId[] {
    const ids = silentSticks(this.lastSeen, now, silenceMs);
    for (const id of ids) this.lastSeen[id] = null;
    return ids;
  }
}
