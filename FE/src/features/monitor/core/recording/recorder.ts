// 세션 녹화. LogRow를 JSONL 한 줄씩 직렬화하고(첫 줄은 meta), 되읽기와 파일 다운로드를 제공한다.
// 서버 전송은 하지 않는다. hex는 공백 없는 대문자 2자리 연속이다.
// 패킷 줄은 kind가 없고, 진단 줄은 {"kind":"diag","t":<ev.t>,"ev":{...t를 뺀 이벤트}}다. 알 수 없는 kind는 되읽을 때 건너뛴다.
// 녹화 중 이 탭이 숨겨지거나 다시 보이면 {"kind":"vis","t":<performance.now()>,"hidden":true|false} 한 줄을 남긴다(다른 줄의 t와 같은 시계).
// 탭이 숨겨진 동안은 브라우저가 타이머·프레임을 늦춰 그 구간 기록이 빠질 수 있다.
import type { DiagEvent } from '@/engine/diagTap';
import type { LogRow, PacketLog } from './packetLog';

export interface RecordingMeta {
  startedAt: string;
  source: { kind: string; label: string };
  firmware: string | null;
  build: string | null;
  profile: Array<{ pad: string; pitch: number; yaw: number; radiusDeg: number }> | null;
  note: string;
  /** 입력 방식. 이전 파일에는 없다 */
  inputMode?: 'direct' | 'follow';
}

export interface RecordedRow {
  t: number;
  dir: 'in' | 'out';
  transport: string;
  stick: 0 | 1 | null;
  /** flags role(0·1 손, 2·3 페달). OUT·role 없는 패킷은 null. 이전 파일에는 없다 */
  role?: number | null;
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
  const base = { t: row.t, dir: row.dir, transport: row.transport, stick: row.stick, role: row.role, hex: bytesToHex(row.bytes) };
  const obj = row.dir === 'out' ? { ...base, decoded: null, outType: row.outType } : { ...base, decoded: row.decoded };
  return JSON.stringify(obj, typedArrayReplacer);
}

/** 진단 이벤트 한 줄. 시각은 t(바깥)에 두고 ev에서는 뺀다 */
export function serializeDiag(ev: DiagEvent): string {
  const { t, ...body } = ev;
  return JSON.stringify({ kind: 'diag', t, ev: body }, typedArrayReplacer);
}

/** 녹화 중 탭 숨김·복귀 한 건(vis 줄) */
export interface VisEvent {
  t: number;
  hidden: boolean;
}

/** 탭 숨김 줄 한 줄 */
export function serializeVis(t: number, hidden: boolean): string {
  return JSON.stringify({ kind: 'vis', t, hidden });
}

/**
 * 되읽기. 첫 줄은 meta, 나머지는 kind 없음 = 패킷 행, 'diag' = 진단 이벤트, 'vis' = 탭 숨김, 그 밖의 kind는 건너뛴다.
 * 빈 줄은 건너뛴다. 이전 형식 파일은 diags·vis가 빈 배열이다
 */
export function parseJsonl(text: string): { meta: RecordingMeta; rows: RecordedRow[]; diags: DiagEvent[]; vis: VisEvent[] } {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('빈 녹화 파일');
  const meta = JSON.parse(lines[0]) as RecordingMeta;
  const rows: RecordedRow[] = [];
  const diags: DiagEvent[] = [];
  const vis: VisEvent[] = [];
  for (const l of lines.slice(1)) {
    const obj = JSON.parse(l) as { kind?: string; t?: number; ev?: object; hidden?: unknown };
    if (obj.kind === undefined) rows.push(obj as unknown as RecordedRow);
    else if (obj.kind === 'diag' && obj.ev && typeof obj.t === 'number') diags.push({ ...obj.ev, t: obj.t } as DiagEvent);
    else if (obj.kind === 'vis' && typeof obj.t === 'number' && typeof obj.hidden === 'boolean') vis.push({ t: obj.t, hidden: obj.hidden });
  }
  return { meta, rows, diags, vis };
}

export class Recorder {
  /** 줄 문자열 또는 진단 이벤트 참조. 도착 순서 그대로 두고 stop()에서 직렬화한다 */
  private items: Array<string | DiagEvent> = [];
  private _recording = false;
  private rowCount = 0;

  get recording(): boolean {
    return this._recording;
  }

  /** meta 줄을 제외한 기록된 패킷 행 + 진단 이벤트 수 */
  get lineCount(): number {
    return this.rowCount;
  }

  start(meta: RecordingMeta): void {
    this.items = [JSON.stringify(meta)];
    this.rowCount = 0;
    this._recording = true;
  }

  append(row: LogRow): void {
    if (!this._recording) return;
    this.items.push(serializeRow(row));
    this.rowCount++;
  }

  /** 진단 이벤트 한 건. 직렬화는 stop()까지 미룬다(직접 연결은 tAudio가 resolved 발행 뒤에 채워진다) */
  appendDiag(ev: DiagEvent): void {
    if (!this._recording) return;
    this.items.push(ev);
    this.rowCount++;
  }

  /** 탭 숨김(hidden=true)·복귀(false) 한 줄. t는 performance.now(). 녹화 중이 아니면 무시한다 */
  appendVis(hidden: boolean, t: number): void {
    if (!this._recording) return;
    this.items.push(serializeVis(t, hidden));
  }

  /** 진단 이벤트 구독(feed.subscribeDiag 등)을 걸어 녹화 중 이벤트를 자동으로 append한다. 반환값은 해제 함수 */
  attachDiag(subscribe: (l: (ev: DiagEvent) => void) => () => void): () => void {
    return subscribe((ev) => this.appendDiag(ev));
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

  /** 녹화를 끝내고 JSONL 텍스트(meta 줄 + 행·진단 줄들, \n 구분)를 돌려준다 */
  stop(): string {
    this._recording = false;
    return this.items.map((it) => (typeof it === 'string' ? it : serializeDiag(it))).join('\n');
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
