// 세션 녹화. LogRow를 JSONL 한 줄씩 직렬화하고(첫 줄은 meta), 되읽기와 파일 다운로드를 제공한다.
// 서버 전송은 하지 않는다. hex는 공백 없는 대문자 2자리 연속이다.
import type { LogRow, PacketLog } from './packetLog';

export interface RecordingMeta {
  startedAt: string;
  source: { kind: string; label: string };
  firmware: string | null;
  build: string | null;
  profile: Array<{ pad: string; pitch: number; yaw: number; radiusDeg: number }> | null;
  note: string;
}

export interface RecordedRow {
  t: number;
  dir: 'in' | 'out';
  transport: string;
  stick: 0 | 1 | null;
  hex: string;
  decoded: unknown;
  outType?: number;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s.toUpperCase();
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 타입 배열(Uint8Array·Int16Array)을 평범한 배열로 바꾸는 JSON replacer */
const typedArrayReplacer = (_key: string, value: unknown): unknown =>
  value instanceof Uint8Array || value instanceof Int16Array ? Array.from(value) : value;

export function serializeRow(row: LogRow): string {
  const base = { t: row.t, dir: row.dir, transport: row.transport, stick: row.stick, hex: bytesToHex(row.bytes) };
  const obj = row.dir === 'out' ? { ...base, decoded: null, outType: row.outType } : { ...base, decoded: row.decoded };
  return JSON.stringify(obj, typedArrayReplacer);
}

/** 되읽기. 첫 줄은 meta, 나머지는 행. 빈 줄은 건너뛴다 */
export function parseJsonl(text: string): { meta: RecordingMeta; rows: RecordedRow[] } {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('빈 녹화 파일');
  const meta = JSON.parse(lines[0]) as RecordingMeta;
  const rows = lines.slice(1).map((l) => JSON.parse(l) as RecordedRow);
  return { meta, rows };
}

export class Recorder {
  private lines: string[] = [];
  private _recording = false;
  private rowCount = 0;

  get recording(): boolean {
    return this._recording;
  }

  /** meta 줄을 제외한 기록된 행 수 */
  get lineCount(): number {
    return this.rowCount;
  }

  start(meta: RecordingMeta): void {
    this.lines = [JSON.stringify(meta)];
    this.rowCount = 0;
    this._recording = true;
  }

  append(row: LogRow): void {
    if (!this._recording) return;
    this.lines.push(serializeRow(row));
    this.rowCount++;
  }

  /** packetLog를 구독해 녹화 중 새로 쌓인 행을 자동으로 append한다. 반환값은 해제 함수 */
  attach(log: PacketLog): () => void {
    const rows = log.rows();
    let lastId = rows.length ? rows[rows.length - 1].id : 0;
    return log.subscribe(() => {
      for (const r of log.rows()) {
        if (r.id > lastId) {
          this.append(r);
          lastId = r.id;
        }
      }
    });
  }

  /** 녹화를 끝내고 JSONL 텍스트(meta 줄 + 행들, \n 구분)를 돌려준다 */
  stop(): string {
    this._recording = false;
    return this.lines.join('\n');
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 기본 파일명 stick-YYYYMMDD-HHMMSS.jsonl */
function defaultFilename(d = new Date()): string {
  return `stick-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}.jsonl`;
}

/** Blob 다운로드. document가 없으면(테스트·SSR) 아무것도 하지 않는다 */
export function downloadJsonl(text: string, filename?: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
