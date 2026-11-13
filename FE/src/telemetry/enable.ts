// 텔레메트리 켜기 상태와 시작·정지. 설계 1-4·2-3·4장.
// 실제 전송 조건 = 저장소의 켜기 값 ∧ 로그인 사용자 role이 ADMIN.
// 켜기 값은 localStorage 키 하나이고, 같은 출처의 다른 창이 바꾸면 storage 이벤트로 따라간다.
// 화면(모니터 제어 섹션)은 이 모듈의 telemetryStore만 구독한다.
import { useAuth } from '@/store/authStore';
import type { UserRole } from '@/domain/account/auth';
import type { StickId } from '@/domain/events';
import { TelemetryCollector } from './collector';
import { TelemetryQueue } from './queue';
import { TelemetrySender, type SenderState } from './sender';
import { isSensorSource } from '@/domain/events';

export const TELEMETRY_STORAGE_KEY = 'airdrum.monitor.telemetry';

/** 켜기 값 저장소. 읽기·쓰기가 던지는 환경(사생활 보호 모드 등)에서는 꺼짐으로 둔다 */
export interface EnableStorage {
  read(): boolean;
  write(on: boolean): void;
  /** 다른 창이 값을 바꿨을 때 불린다. 반환값은 해제 */
  subscribe(onChange: () => void): () => void;
}

export const browserEnableStorage: EnableStorage = {
  read() {
    try {
      return localStorage.getItem(TELEMETRY_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  },
  write(on) {
    try {
      localStorage.setItem(TELEMETRY_STORAGE_KEY, on ? '1' : '0');
    } catch {
      // 저장 못 하면 이 창의 메모리 상태만 따른다
    }
  },
  subscribe(onChange) {
    const h = (e: StorageEvent) => {
      // key가 null이면 저장소 전체 비움
      if (e.key === null || e.key === TELEMETRY_STORAGE_KEY) onChange();
    };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  },
};

/** 화면용 상태 */
export interface TelemetryViewState {
  /** 저장소 켜기 값 */
  enabled: boolean;
  /** 로그인 사용자가 ADMIN인가 */
  roleOk: boolean;
  /** 지금 실제로 수집·전송 중(enabled ∧ roleOk) */
  active: boolean;
  /** 403으로 자동으로 꺼졌다. 다시 켜면 풀린다 */
  forbidden: boolean;
  sender: SenderState;
}

interface Collectorish {
  start(): void;
  stop(): void;
  setActiveSource(kind: string | null): void;
  notifyConnection(stickId: StickId, connected: boolean, source: string): void;
}
interface Senderish {
  start(): void;
  stop(): void;
  flushOnce(): Promise<void>;
  getState(): SenderState;
  subscribe(l: () => void): () => void;
}

export interface ControllerDeps {
  storage: EnableStorage;
  collector: Collectorish;
  sender: Senderish;
  queue: { clear(): void };
  getRole(): UserRole | null;
  /** 로그인 상태 변화 구독 */
  subscribeRole(l: () => void): () => void;
}

export class TelemetryController {
  private enabled: boolean;
  private roleOk: boolean;
  private active = false;
  private forbidden = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: TelemetryViewState;
  private readonly unsubs: (() => void)[] = [];

  private readonly deps: ControllerDeps;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
    this.enabled = deps.storage.read();
    this.roleOk = deps.getRole() === 'ADMIN';
    this.snapshot = this.build();
    this.unsubs.push(
      deps.storage.subscribe(() => {
        this.enabled = deps.storage.read();
        if (this.enabled) this.forbidden = false;
        this.reevaluate();
      }),
      deps.subscribeRole(() => {
        this.roleOk = deps.getRole() === 'ADMIN';
        this.reevaluate();
      }),
      deps.sender.subscribe(() => this.notify()),
    );
    this.reevaluate();
  }

  getSnapshot(): TelemetryViewState {
    return this.snapshot;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** 모니터 토글이 부른다. 켜면 403 표시를 지운다 */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.forbidden = false;
    this.deps.storage.write(on);
    this.reevaluate();
  }

  /** 전송기가 403을 받았을 때(sender.onForbidden). 저장소 값을 끄고 사유를 남긴다 */
  handleForbidden(): void {
    this.forbidden = true;
    this.enabled = false;
    this.deps.storage.write(false);
    this.reevaluate();
  }

  /** 소스 연결 상태 변화. 꺼져 있으면 STATUS를 만들지 않는다 */
  notifyConnection(stickId: StickId, connected: boolean, source: string): void {
    if (this.active) this.deps.collector.notifyConnection(stickId, connected, source);
  }

  setActiveSource(kind: string | null): void {
    this.deps.collector.setActiveSource(kind);
  }

  /** 페이지를 떠날 때 남은 큐를 한 번 보낸다(최선 노력, 기다리지 않음) */
  flushNow(): void {
    if (this.active) void this.deps.sender.flushOnce();
  }

  dispose(): void {
    for (const u of this.unsubs.splice(0)) u();
    this.listeners.clear();
  }

  private reevaluate(): void {
    const want = this.enabled && this.roleOk;
    if (want && !this.active) {
      this.active = true;
      this.deps.collector.start();
      this.deps.sender.start();
    } else if (!want && this.active) {
      this.active = false;
      // 남은 큐는 한 번만 보내 본다. 403이거나 ADMIN이 아니면 보내 봐야 거절되므로 건너뛴다
      const flush = this.roleOk && !this.forbidden;
      this.deps.collector.stop();
      const done = () => {
        // 그 사이 다시 켜졌으면 건드리지 않는다
        if (this.active) return;
        this.deps.sender.stop();
        this.deps.queue.clear();
        this.notify();
      };
      if (flush) void this.deps.sender.flushOnce().then(done, done);
      else done();
    }
    this.notify();
  }

  private build(): TelemetryViewState {
    return {
      enabled: this.enabled,
      roleOk: this.roleOk,
      active: this.active,
      forbidden: this.forbidden,
      sender: this.deps.sender.getState(),
    };
  }

  private notify(): void {
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }
}

// ── 앱 단일 인스턴스 ─────────────────────────────────────────

/** initTelemetry가 불리기 전에도 화면이 읽을 수 있는 빈 상태 */
const IDLE_STATE: TelemetryViewState = {
  enabled: false,
  roleOk: false,
  active: false,
  forbidden: false,
  sender: {
    running: false,
    inflight: false,
    sent: 0,
    unknown: 0,
    rejected: 0,
    unauthorized: 0,
    drops: { overflow: 0, ttl: 0, oversize: 0 },
    queueSize: 0,
    lastError: null,
    forbidden: false,
  },
};

let controller: TelemetryController | null = null;
const viewListeners = new Set<() => void>();

/** useSyncExternalStore용. 모니터 제어 섹션이 쓴다 */
export const telemetryStore = {
  getSnapshot: (): TelemetryViewState => controller?.getSnapshot() ?? IDLE_STATE,
  subscribe(l: () => void): () => void {
    viewListeners.add(l);
    return () => viewListeners.delete(l);
  },
  /** initTelemetry 전이면 저장소 값만 바꾼다(init이 읽는다) */
  setEnabled(on: boolean): void {
    if (controller) controller.setEnabled(on);
    else browserEnableStorage.write(on);
  },
};

export interface InitTelemetryDeps {
  /** 소스 연결 상태 구독(InputManager.onStatus). 반환값은 해제 */
  subscribeConnection(l: (stickId: StickId, connected: boolean, source: string) => void): () => void;
  /** 지금 활성 센서 소스 id. 없으면 null */
  getActiveSource(): string | null;
  /** 활성 센서 소스 id가 바뀔 때 불린다. 반환값은 해제 */
  subscribeActiveSource(l: () => void): () => void;
}

/** bootstrap이 모니터 빌드에서 한 번 부른다. 두 번째부터는 무시 */
export function initTelemetry(deps: InitTelemetryDeps): void {
  if (controller) return;
  const queue = new TelemetryQueue({ now: () => performance.now() });
  const collector = new TelemetryCollector({ sink: queue });
  const sender = new TelemetrySender({
    queue,
    now: () => performance.now(),
    // controller 변수는 아래에서 채워진다(403은 시작 뒤에야 오므로 그 전에 불리지 않는다)
    onForbidden: () => controller?.handleForbidden(),
  });
  const c = new TelemetryController({
    storage: browserEnableStorage,
    collector,
    sender,
    queue,
    getRole: () => useAuth.getState().user?.role ?? null,
    subscribeRole: (l) => useAuth.subscribe(l),
  });
  controller = c;
  c.subscribe(() => {
    for (const l of viewListeners) l();
  });

  const syncSource = () => c.setActiveSource(deps.getActiveSource());
  syncSource();
  deps.subscribeActiveSource(syncSource);
  deps.subscribeConnection((stickId, connected, source) => {
    // 키보드는 센서 연결 진단 대상이 아니다
    if (isSensorSource(source)) c.notifyConnection(stickId, connected, source);
  });
  window.addEventListener('pagehide', () => c.flushNow());
  for (const l of viewListeners) l();
}
