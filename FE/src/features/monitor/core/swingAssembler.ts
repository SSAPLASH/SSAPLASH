// SWING 청크 조립기. 한 번의 스윙(원시 IMU 구간)이 여러 SWING 패킷(청크)으로 나뉘어 오므로
// (stick, hitSeq) 단위로 모아 하나의 레코드로 합치고, 그래프용 시계열로 바꿔 준다.
// 판정 경로와 무관하다(모니터 전용).
import type { DecodedSwing } from '@/input/stickProtocol';

// EMB 회신 3(2026-10-26): 844Hz·1.18ms 간격, 가속도 1mg·자이로 0.1°/s per LSB(펌웨어 변환 단위), 타임아웃 3초 권장
/** 샘플 주기(ms). 약 844Hz(IMU 1.66kHz의 2샘플당 1개) */
export const SWING_SAMPLE_PERIOD_MS = 1.18;
/** 가속도 1 LSB당 mg */
export const SWING_ACCEL_SCALE = 1;
/** 자이로 1 LSB당 °/s */
export const SWING_GYRO_SCALE = 0.1;
/** 첫 청크 이후 이 시간 안에 다 못 받으면 확정 처리(ms) */
export const SWING_TIMEOUT_MS = 3000;

/** 보관할 최대 레코드 수 */
const MAX_RECORDS = 20;
/** 샘플당 값 개수(ax ay az gx gy gz) */
const AXES = 6;

export interface SwingRecord {
  /** `${stick}-${hitSeq}` */
  key: string;
  stick: 0 | 1;
  hitSeq: number;
  chunkCount: number;
  receivedChunks: number;
  /** 못 받은 chunkIdx */
  missing: number[];
  complete: boolean;
  timedOut: boolean;
  firstT: number;
  lastT: number;
  /** 6 × N. 누락 청크 자리는 0으로 채우고 missing에 기록 */
  samples: Int16Array;
  sampleCount: number;
}

export interface SwingSeries {
  ax: Float32Array;
  ay: Float32Array;
  az: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  gz: Float32Array;
  tMs: Float32Array;
}

interface Internal {
  rec: SwingRecord;
  samplesPerChunk: number;
  got: Set<number>;
}

export class SwingAssembler {
  private now: () => number;
  /** 최신이 앞 */
  private items: Internal[] = [];
  private listeners = new Set<() => void>();
  private _version = 0;

  constructor(deps: { now?: () => number } = {}) {
    this.now = deps.now ?? (() => performance.now());
  }

  get version(): number {
    return this._version;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private bump(): void {
    this._version++;
    for (const fn of this.listeners) fn();
  }

  private static missingOf(it: Internal): number[] {
    const out: number[] = [];
    for (let i = 0; i < it.rec.chunkCount; i++) if (!it.got.has(i)) out.push(i);
    return out;
  }

  /** 청크 하나를 넣는다. 범위 밖·중복 청크는 무시하고 현재 레코드를 그대로 돌려준다 */
  push(p: DecodedSwing, stick: 0 | 1, t: number): SwingRecord {
    const key = `${stick}-${p.hitSeq}`;
    let it = this.items.find((x) => x.rec.key === key);
    if (!it) {
      const spc = Math.floor(p.samples.length / AXES);
      const count = Math.max(0, p.chunkCount);
      it = {
        samplesPerChunk: spc,
        got: new Set(),
        rec: {
          key,
          stick,
          hitSeq: p.hitSeq,
          chunkCount: count,
          receivedChunks: 0,
          missing: [],
          complete: false,
          timedOut: false,
          firstT: t,
          lastT: t,
          samples: new Int16Array(count * spc * AXES),
          sampleCount: count * spc,
        },
      };
      it.rec.missing = SwingAssembler.missingOf(it);
      this.items.unshift(it);
      if (this.items.length > MAX_RECORDS) this.items.length = MAX_RECORDS;
    }
    const { rec } = it;
    if (p.chunkIdx >= rec.chunkCount || it.got.has(p.chunkIdx)) return rec;
    const room = it.samplesPerChunk * AXES;
    const part = p.samples.length > room ? p.samples.subarray(0, room) : p.samples;
    rec.samples.set(part, p.chunkIdx * room);
    it.got.add(p.chunkIdx);
    rec.receivedChunks = it.got.size;
    rec.lastT = t;
    rec.missing = SwingAssembler.missingOf(it);
    rec.complete = rec.receivedChunks === rec.chunkCount;
    this.bump();
    return rec;
  }

  /** 시간 초과한 미완성 레코드를 확정한다. 확정한 개수를 돌려준다 */
  tick(now: number = this.now()): number {
    let n = 0;
    for (const { rec } of this.items) {
      if (!rec.complete && !rec.timedOut && rec.firstT + SWING_TIMEOUT_MS < now) {
        rec.timedOut = true;
        n++;
      }
    }
    if (n > 0) this.bump();
    return n;
  }

  /** 최신 먼저 */
  list(): SwingRecord[] {
    return this.items.map((x) => x.rec);
  }

  get(key: string): SwingRecord | undefined {
    return this.items.find((x) => x.rec.key === key)?.rec;
  }

  clear(): void {
    this.items = [];
    this.bump();
  }

  toSeries(rec: SwingRecord): SwingSeries {
    return toSeries(rec);
  }
}

/** 스케일을 적용한 시계열. 마지막 샘플이 0ms(타격 직전 구간)이고 앞쪽은 음수 */
export function toSeries(rec: SwingRecord): SwingSeries {
  const n = rec.sampleCount;
  const s: SwingSeries = {
    ax: new Float32Array(n),
    ay: new Float32Array(n),
    az: new Float32Array(n),
    gx: new Float32Array(n),
    gy: new Float32Array(n),
    gz: new Float32Array(n),
    tMs: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const o = i * AXES;
    s.ax[i] = rec.samples[o] * SWING_ACCEL_SCALE;
    s.ay[i] = rec.samples[o + 1] * SWING_ACCEL_SCALE;
    s.az[i] = rec.samples[o + 2] * SWING_ACCEL_SCALE;
    s.gx[i] = rec.samples[o + 3] * SWING_GYRO_SCALE;
    s.gy[i] = rec.samples[o + 4] * SWING_GYRO_SCALE;
    s.gz[i] = rec.samples[o + 5] * SWING_GYRO_SCALE;
    s.tMs[i] = (i - (n - 1)) * SWING_SAMPLE_PERIOD_MS;
  }
  return s;
}
