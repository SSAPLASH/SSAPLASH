// 패킷 탭. 입력 소스가 프레이밍을 벗긴 payload를 파싱 직전(수신)·송신 직후에 publish하고,
// 모니터가 구독한다. 구독자가 없으면 레코드 객체를 만들지 않는다.

export interface PacketRecord {
  /** 발행 순서대로 증가하는 정수 */
  id: number;
  dir: 'in' | 'out';
  transport: 'ws' | 'ble' | 'serial' | 'mock';
  /** 링크가 손을 아는 경우(BLE)만. 모르면 null */
  stickId: 0 | 1 | null;
  /** 프레이밍을 벗긴 payload */
  bytes: Uint8Array;
  /** performance.now() */
  recvTime: number;
}

export type PacketListener = (rec: PacketRecord) => void;

class PacketTap {
  private listeners = new Set<PacketListener>();
  private nextId = 1;

  /** 구독자가 있는지. 호출자가 bytes 복사 같은 준비 비용을 아낄 때 쓴다 */
  get active(): boolean {
    return this.listeners.size > 0;
  }

  publish(rec: Omit<PacketRecord, 'id'>): void {
    if (this.listeners.size === 0) return;
    const full: PacketRecord = { ...rec, id: this.nextId++ };
    for (const l of this.listeners) l(full);
  }

  subscribe(fn: PacketListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const packetTap = new PacketTap();
