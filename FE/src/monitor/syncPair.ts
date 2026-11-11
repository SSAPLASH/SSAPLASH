// SYNC 송신 ↔ SYNC_ACK 짝짓기 규칙. packetLog(실시간)와 녹화 요약(recordingSummary)이 같은 규칙을 쓴다.
// 짝 키는 송신 바이트 안의 u32 t0(펌웨어가 SYNC_ACK로 되돌려주는 값)다. publish 시각의 floor를 쓰면
// 소스가 t0를 찍은 뒤 publish까지의 간격(Serial은 writeChain 대기로 수 ms)에 ms 경계를 넘어 어긋난다.

/** 이 시간(ms)을 넘긴 pending SYNC는 유실로 버린다 */
export const SYNC_PENDING_MS = 2000;

/** 송신 SYNC 바이트(타입 1 + u32 t0)에서 짝 키를 읽는다. 짧으면 null */
export function syncKeyOf(bytes: Uint8Array): number | null {
  if (bytes.length < 5) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, true);
}

/** 짝짓기 칸. 0·1 = 왼손·오른손, 2 = 페달 보드(role 2·3이 같은 시계라 한 칸) */
export type SyncSlot = 0 | 1 | 2;

interface PendingSync {
  t: number;
  key: number;
  /** 이미 짝을 맺은 칸(칸별로 한 번씩만). 0·1 = 손, 2 = 페달 보드 */
  matched: Set<SyncSlot>;
}

export class SyncPairer {
  private pending: PendingSync[] = [];

  clear(): void {
    this.pending = [];
  }

  /** now 기준으로 SYNC_PENDING_MS를 넘긴 pending을 버린다 */
  expire(now: number): void {
    while (this.pending.length > 0 && now - this.pending[0].t > SYNC_PENDING_MS) this.pending.shift();
  }

  /** 송신한 SYNC 등록. t = 송신(publish) 시각 */
  addOut(t: number, key: number): void {
    this.pending.push({ t, key, matched: new Set() });
  }

  /**
   * SYNC_ACK의 t0Ms와 키가 같고 이 스틱이 아직 짝짓지 않은 pending 중 가장 오래된 것을 짝지어 그 송신 시각(t0)을 돌려준다.
   * 못 찾으면 null(FIFO 폴백 없음). SYNC 1건에 스틱마다 ACK가 오므로 pending은 짝지어도 만료까지 둔다
   */
  match(key: number, stick: SyncSlot): number | null {
    const pend = this.pending.find((p) => p.key === key && !p.matched.has(stick));
    if (!pend) return null;
    pend.matched.add(stick);
    return pend.t;
  }
}
