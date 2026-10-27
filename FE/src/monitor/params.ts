// 파라미터 패널 상태기. GET_PARAMS → PARAM_ACK 수집(종료 표시 0x00), SET_PARAM 전송·응답 대기(500ms),
// 적용 확인 예약 id(0x20·0x21·0x22) 기록을 맡는다. 전송 수단은 생성자로 주입받고 화면은 모른다.
import {
  encodeGetParams,
  encodeSetParam,
  PARAM_ACK_END,
  PARAM_ACK_PAD_TABLE,
  PARAM_ACK_RESET_POSE,
  PARAM_ACK_YAW_OFFSET,
  STICK_PARAMS,
  firmwareOfMajor,
  stickParamDefault,
  type DecodedPacket,
  type StickFirmware,
  type StickParam,
} from '@/input/stickProtocol';

export type ParamPanelState = 'unknown' | 'loading' | 'loaded';

export interface ParamRow {
  id: number;
  meta: StickParam;
  current: number | null;
  input: number | null;
  pending: boolean;
  note: 'lost' | 'clipped' | 'noAck' | null;
}

export interface Confirmation {
  kind: 'padTable' | 'yawOffset' | 'resetPose';
  /** 적용값. open이 false인데 null이면 확인 없음 */
  value: number | null;
  /** 500ms 확인 창이 아직 열려 있는지(대기 중) */
  open: boolean;
  t: number;
  /** 'command'는 명령 바 요청에 대한 응답, 'button'은 요청 없이 온 스틱 버튼 보정(USER 버튼 → RESET_POSE) */
  source: 'command' | 'button';
}

export interface ParamStoreDeps {
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
}

/** GET_PARAMS 종료 표시가 안 왔을 때의 보조 타임아웃 */
const LOAD_TIMEOUT_MS = 1000;
/** SET_PARAM·적용 확인 응답 대기 */
const ACK_WINDOW_MS = 500;
const MAX_CONFIRMATIONS = 20;

const CONFIRM_ID: Record<number, Confirmation['kind']> = {
  [PARAM_ACK_PAD_TABLE]: 'padTable',
  [PARAM_ACK_YAW_OFFSET]: 'yawOffset',
  [PARAM_ACK_RESET_POSE]: 'resetPose',
};

interface ConfirmEntry extends Confirmation {
  open: boolean;
}

interface RowState {
  current: number | null;
  input: number | null;
  pending: boolean;
  note: ParamRow['note'];
}

const freshRow = (): RowState => ({ current: null, input: null, pending: false, note: null });

export class ParamStore {
  state: ParamPanelState = 'unknown';
  /** GET_PARAMS 종료 표시로 알게 된 유실 개수. 아직 모르면 null */
  lostCount: number | null = null;
  version = 0;
  /** 마지막 STATUS의 fwMajor. 아직 못 받았으면 null(기본값 표는 Feather로 본다) */
  fwMajor: number | null = null;

  private send: (bytes: Uint8Array) => void;
  private deps: Required<ParamStoreDeps>;
  private listeners = new Set<() => void>();
  private rowState = new Map<number, RowState>();
  private received = new Set<number>();
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private confirms: ConfirmEntry[] = [];
  private confirmTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(send: (bytes: Uint8Array) => void, deps: ParamStoreDeps = {}) {
    this.send = send;
    this.deps = {
      now: deps.now ?? (() => performance.now()),
      setTimeout: deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms)),
      clearTimeout: deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id)),
    };
    this.initRows();
  }

  private initRows(): void {
    this.rowState.clear();
    for (const p of STICK_PARAMS) this.rowState.set(p.id, freshRow());
  }

  private row(id: number): RowState {
    let r = this.rowState.get(id);
    if (!r) {
      r = freshRow();
      this.rowState.set(id, r);
    }
    return r;
  }

  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 지금 쓰는 기본값 표의 펌웨어. STATUS 전이면 Feather */
  firmware(): StickFirmware {
    return this.fwMajor === null ? 'feather' : firmwareOfMajor(this.fwMajor);
  }

  /** STICK_PARAMS 순서의 표 행 */
  rows(): ParamRow[] {
    return STICK_PARAMS.map((meta) => ({ id: meta.id, meta, ...this.row(meta.id) }));
  }

  /** 최신 먼저, 최대 20개 */
  confirmations(): Confirmation[] {
    return this.confirms.slice(0, MAX_CONFIRMATIONS).map(({ kind, value, t, open, source }) => ({ kind, value, t, open, source }));
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== null) this.deps.clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  /** 받지 못한 id를 '유실'로 표시하고 loaded로 전이 */
  private finishLoad(): void {
    this.clearLoadTimer();
    for (const p of STICK_PARAMS) {
      if (!this.received.has(p.id)) {
        const r = this.row(p.id);
        r.current = null;
        r.note = 'lost';
      }
    }
    this.state = 'loaded';
  }

  load(): void {
    this.clearLoadTimer();
    this.received.clear();
    this.lostCount = null;
    for (const p of STICK_PARAMS) {
      const r = this.row(p.id);
      r.current = null;
      r.note = null;
    }
    this.state = 'loading';
    this.send(encodeGetParams());
    this.loadTimer = this.deps.setTimeout(() => {
      this.loadTimer = null;
      if (this.state !== 'loading') return;
      // 종료 표시가 오지 않았다: 유실 개수는 알 수 없다
      this.finishLoad();
      this.changed();
    }, LOAD_TIMEOUT_MS);
    this.changed();
  }

  onPacket(p: DecodedPacket): void {
    if (p.kind === 'status') {
      // 스틱 2개의 fwMajor가 다르면 마지막 STATUS 기준
      if (p.fwMajor !== this.fwMajor) {
        this.fwMajor = p.fwMajor;
        this.changed();
      }
      return;
    }
    if (p.kind !== 'paramAck') return;
    const id = p.paramId;
    if (id === PARAM_ACK_END) {
      this.lostCount = Math.max(0, p.value - this.received.size);
      this.finishLoad();
      this.changed();
      return;
    }
    const confirmKind = CONFIRM_ID[id];
    if (confirmKind) {
      // 열린 확인 창 중 가장 최근 것에 값을 채운다(padTable은 여러 패킷이면 마지막 값으로 갱신)
      const entry = this.confirms.find((c) => c.open && c.kind === confirmKind);
      if (entry) {
        entry.value = p.value;
        this.changed();
      } else if (confirmKind === 'resetPose') {
        // 요청 없이 온 0x22: 스틱 USER 버튼으로 정면 보정이 일어났다(Feather fw 1.0)
        this.confirms.unshift({ kind: 'resetPose', value: p.value, t: this.deps.now(), open: false, source: 'button' });
        if (this.confirms.length > MAX_CONFIRMATIONS) this.confirms.length = MAX_CONFIRMATIONS;
        this.changed();
      }
      return;
    }
    if (!STICK_PARAMS.some((m) => m.id === id)) return;
    const r = this.row(id);
    this.received.add(id);
    r.current = p.value;
    if (r.note === 'lost') r.note = null;
    if (r.pending) {
      r.pending = false;
      r.note = r.input !== p.value ? 'clipped' : null;
      const timer = this.ackTimers.get(id);
      if (timer !== undefined) this.deps.clearTimeout(timer);
      this.ackTimers.delete(id);
    }
    this.changed();
  }

  /** SET_PARAM 전송. 500ms 안에 응답이 없으면 '응답 없음' */
  apply(id: number, value: number): void {
    this.send(encodeSetParam(id, value));
    const r = this.row(id);
    r.pending = true;
    r.input = value;
    r.note = null;
    const old = this.ackTimers.get(id);
    if (old !== undefined) this.deps.clearTimeout(old);
    this.ackTimers.set(
      id,
      this.deps.setTimeout(() => {
        this.ackTimers.delete(id);
        const cur = this.row(id);
        if (!cur.pending) return;
        cur.pending = false;
        cur.note = 'noAck';
        this.changed();
      }, ACK_WINDOW_MS),
    );
    this.changed();
  }

  /** 모든 파라미터를 지금 펌웨어 표의 기본값으로 SET_PARAM */
  resetDefaults(): void {
    const fw = this.firmware();
    for (const p of STICK_PARAMS) this.apply(p.id, stickParamDefault(p, fw));
  }

  /** 명령 바가 SET_PAD_TABLE·SET_YAW_OFFSET·RESET_POSE를 보낸 직후 호출. 500ms 창을 연다 */
  expectConfirmation(kind: Confirmation['kind']): void {
    const entry: ConfirmEntry = { kind, value: null, t: this.deps.now(), open: true, source: 'command' };
    this.confirms.unshift(entry);
    if (this.confirms.length > MAX_CONFIRMATIONS) this.confirms.length = MAX_CONFIRMATIONS;
    const timer = this.deps.setTimeout(() => {
      this.confirmTimers.delete(timer);
      // 창 안에 안 왔으면 value는 null 그대로 = 확인 없음
      entry.open = false;
      this.changed();
    }, ACK_WINDOW_MS);
    this.confirmTimers.add(timer);
    this.changed();
  }

  /** 상태를 unknown으로 되돌리고 타이머를 정리한다 */
  reset(): void {
    this.clearLoadTimer();
    for (const t of this.ackTimers.values()) this.deps.clearTimeout(t);
    this.ackTimers.clear();
    for (const t of this.confirmTimers) this.deps.clearTimeout(t);
    this.confirmTimers.clear();
    this.received.clear();
    this.confirms = [];
    this.lostCount = null;
    this.fwMajor = null;
    this.state = 'unknown';
    this.initRows();
    this.changed();
  }
}
