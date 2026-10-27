// Web Serial(USB 직결) 프레이밍. 스틱 프로토콜 v0.7 3장.
//   [SOF 0xA5][LEN u8][payload × LEN][CRC8]  — CRC8은 payload 기준(다항식 0x07, 초기값 0x00)
// 스트림은 바이트 경계가 보장되지 않으므로 FrameDecoder가 조각난 입력을 이어 붙여 프레임을 복원한다.

export const SOF = 0xa5;
/** payload 최대 길이(LEN이 u8) */
export const MAX_PAYLOAD = 255;

/** CRC-8/SMBUS: 다항식 0x07, MSB-first, 초기값 기본 0x00 */
export function crc8(bytes: Uint8Array, init = 0): number {
  let crc = init & 0xff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

/** payload를 [SOF, LEN, payload, CRC8]로 감싼다. 길이 0 또는 255 초과면 예외 */
export function frame(payload: Uint8Array): Uint8Array<ArrayBuffer> {
  if (payload.length === 0 || payload.length > MAX_PAYLOAD) {
    throw new RangeError(`payload 길이는 1~${MAX_PAYLOAD}바이트여야 합니다: ${payload.length}`);
  }
  const out = new Uint8Array(payload.length + 3);
  out[0] = SOF;
  out[1] = payload.length;
  out.set(payload, 2);
  out[out.length - 1] = crc8(payload);
  return out;
}

export interface FrameStats {
  crcErrors: number;
  resyncCount: number;
  droppedBytes: number;
}

export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);
  private crcErrors = 0;
  private resyncCount = 0;
  private droppedBytes = 0;
  /** 쓰레기 구간 안에 있는지. 한 구간은 resyncCount를 한 번만 올린다 */
  private inGarbage = false;
  private readonly maxLen: number;

  /** @param maxLen 이보다 큰 LEN은 즉시 불일치로 본다 */
  constructor(maxLen = 64) {
    this.maxLen = maxLen;
  }

  /** 바이트를 이어 붙이고, 완성된 payload들(복사본)을 돌려준다 */
  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length > 0) {
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }
    const out: Uint8Array[] = [];
    let pos = 0;
    const buf = this.buf;
    while (pos < buf.length) {
      if (buf[pos] !== SOF) {
        // SOF가 나올 때까지 버린다
        let next = buf.indexOf(SOF, pos);
        if (next < 0) next = buf.length;
        this.droppedBytes += next - pos;
        if (!this.inGarbage) {
          this.inGarbage = true;
          this.resyncCount++;
        }
        pos = next;
        continue;
      }
      this.inGarbage = false;
      if (buf.length - pos < 2) break; // LEN 대기
      const len = buf[pos + 1];
      if (len === 0 || len > this.maxLen) {
        // 불일치: SOF 한 바이트만 버리고 다음 바이트부터 재탐색
        this.droppedBytes++;
        pos++;
        continue;
      }
      const total = len + 3;
      if (buf.length - pos < total) break; // 나머지 대기
      const payload = buf.subarray(pos + 2, pos + 2 + len);
      if (crc8(payload) === buf[pos + total - 1]) {
        out.push(payload.slice());
        pos += total;
      } else {
        this.crcErrors++;
        this.droppedBytes++;
        pos++; // SOF 다음 바이트부터 재탐색(안쪽에 진짜 SOF가 있을 수 있다)
      }
    }
    this.buf = pos >= buf.length ? new Uint8Array(0) : buf.slice(pos);
    return out;
  }

  stats(): FrameStats {
    return { crcErrors: this.crcErrors, resyncCount: this.resyncCount, droppedBytes: this.droppedBytes };
  }

  reset(): void {
    this.buf = new Uint8Array(0);
    this.crcErrors = 0;
    this.resyncCount = 0;
    this.droppedBytes = 0;
    this.inGarbage = false;
  }
}
