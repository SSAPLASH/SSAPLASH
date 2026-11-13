// 방위각 드리프트 감지·보정. 스틱 방위각은 자이로 적분이라 시간이 지나면 밀린다.
// 믿을 만한 타격의 (스틱 보고 yaw − 패드 앵커 yaw)를 스틱별 링에 모아, 중앙값이 크고 퍼짐이 작으면
// SET_YAW_OFFSET(0x16, 절대값 설정)으로 되돌리고 PARAM_ACK 0x21로 적용값을 확인한다. 설계: PLAY-002 yaw drift.
// padTableSync와 같은 구조(setSource·onStatus 콜백·packetTap 구독·500ms 확인 창).
// input → store 직접 import는 금지라 상태는 onStatus 콜백으로 밖에 알린다(bootstrap이 liveStore에 연결).
import {
  median,
  medianAbsDev,
  wrap180,
  type CalibrationProfile,
  type YawDriftStatus,
} from '@/domain/kit/calibration/calibration';
import type { ResolvedHit, StickId } from '@/domain/events';
import {
  DRIFT_COOLDOWN_MS,
  DRIFT_MAX_SPREAD_DEG,
  DRIFT_MIN_DEG,
  DRIFT_MIN_SAMPLES,
  DRIFT_WINDOW,
} from '@/domain/kit/calibration/tuning';
import type { InputSource } from './source/InputSource';
import { packetTap } from './packetTap';
import { decodePacket, encodeGetParams, encodeSetYawOffset, handOf, PARAM_ACK_YAW_OFFSET } from './stickProtocol';
import { isSensorSource } from '@/domain/events';

export type { YawDriftStatus };

/** SET_YAW_OFFSET을 보낸 사실과 근거. bootstrap이 진단 줄(yawCorrect)로 잇는다 */
export interface YawCorrection {
  stickId: StickId;
  /** drift 자동 드리프트 보정 / realign 재정렬 / connected 연결 직후 0 초기화 */
  reason: 'drift' | 'realign' | 'connected';
  /** 보내기 전 적용값(도) */
  prevDeg: number;
  /** 보낸 절대값(도) */
  sentDeg: number;
  /** 링 중앙값 = 오차(도). realign은 요청받은 오차, connected는 null */
  medianDeg: number | null;
  /** 중앙값 절대편차(도). drift만 */
  madDeg: number | null;
  /** 그때 링의 (스틱 yaw − 앵커 yaw) 샘플. drift만 채운다 */
  samples: number[];
}

/** 전송 후 PARAM_ACK를 기다리는 시간(ms) */
const ACK_WINDOW_MS = 500;
const STICKS: readonly StickId[] = [0, 1];

interface StickState {
  ring: number[];
  applied: number;
  lastErr: number | null;
  lastSentAt: number | null;
  acked: boolean | null;
  windowOpen: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const blank = (): StickState => ({
  ring: [],
  applied: 0,
  lastErr: null,
  lastSentAt: null,
  acked: null,
  windowOpen: false,
  timer: null,
});

class YawDriftMonitor {
  private source: InputSource | null = null;
  private offState: (() => void) | null = null;
  private offTap: (() => void) | null = null;
  private sticks: [StickState, StickState] = [blank(), blank()];
  /** 일시정지 중에는 observe를 무시한다(보정·재정렬 중, PLAY-004 D7) */
  private paused = false;
  /** 자동 보정 사용 여부(설정). 꺼져 있으면 observe를 무시한다. 재정렬(correct)·연결 직후 초기화는 그대로 한다 */
  private auto = true;
  private statusCb: ((stickId: StickId, st: YawDriftStatus | null) => void) | null = null;

  constructor() {
    this.subscribeTap();
  }

  /** 상태 보고 콜백 등록(1개). 이후 스틱 상태가 바뀔 때마다 호출한다 */
  onStatus(cb: (stickId: StickId, st: YawDriftStatus | null) => void): void {
    this.statusCb = cb;
  }

  private correctionCb: ((c: YawCorrection) => void) | null = null;

  /** 보정 전송 콜백 등록(1개). SET_YAW_OFFSET을 보낼 때마다 호출한다 */
  onCorrection(cb: (c: YawCorrection) => void): void {
    this.correctionCb = cb;
  }

  /** 보낼 수 있는 소스(연결됨 + sendCommand)면 반환, 아니면 null */
  private usable(): InputSource | null {
    const src = this.source;
    return src && src.sendCommand && src.state === 'connected' ? src : null;
  }

  private subscribeTap(): void {
    this.offTap?.();
    this.offTap = packetTap.subscribe((rec) => {
      if (rec.dir !== 'in' || !this.usable()) return;
      const pkt = decodePacket(rec.bytes, rec.recvTime);
      if (pkt.kind !== 'paramAck' || pkt.paramId !== PARAM_ACK_YAW_OFFSET) return;
      const value = pkt.value / 100;
      // 손은 레코드(BLE·WS 링크) → 패킷 role(0·1) 순으로 가린다. 둘 다 없으면 확인 창이 열린 손만(padTableSync와 같은 규칙).
      // Web Serial 레코드는 손을 모른다. role로 가리지 않으면 한 손의 적용값이 다른 손 기억을 덮어써, 다음 보정(절대값)이 그 차이만큼 튄다
      const hand = rec.stickId ?? handOf(pkt.role);
      const targets: StickId[] = hand !== null ? [hand] : STICKS.filter((i) => this.sticks[i].windowOpen);
      for (const i of targets) {
        const s = this.sticks[i];
        // 창 밖 0x21(모니터 수동 명령 등)도 적용값에는 반영하되 acked는 건드리지 않는다. 상태가 없는 스틱은 건너뜀
        if (!s.windowOpen && !this.hasStatus(i)) continue;
        s.applied = value;
        if (s.windowOpen) s.acked = true;
        this.report(i);
      }
    });
  }

  /** 상태를 보고 중인(연결돼 보정 대상인) 스틱 표시. forget·suspend 때 꺼진다 */
  private active: [boolean, boolean] = [false, false];
  private hasStatus(i: StickId): boolean {
    return this.active[i];
  }

  private status(i: StickId): YawDriftStatus {
    const s = this.sticks[i];
    return {
      appliedDeg: s.applied,
      samples: s.ring.length,
      lastErrorDeg: s.lastErr,
      lastSentAt: s.lastSentAt,
      acked: s.acked,
    };
  }

  private report(i: StickId): void {
    this.active[i] = true;
    this.statusCb?.(i, this.status(i));
  }

  private clearWindow(s: StickState): void {
    if (s.timer !== null) globalThis.clearTimeout(s.timer);
    s.timer = null;
    s.windowOpen = false;
  }

  private openWindow(i: StickId): void {
    const s = this.sticks[i];
    this.clearWindow(s);
    s.windowOpen = true;
    s.timer = globalThis.setTimeout(() => {
      s.timer = null;
      s.windowOpen = false;
      if (s.acked === null) {
        s.acked = false; // 보낸 값은 유지한다
        this.report(i);
      }
    }, ACK_WINDOW_MS);
  }

  private forget(i: StickId): void {
    this.clearWindow(this.sticks[i]);
    this.sticks[i] = blank();
    if (this.active[i]) {
      this.active[i] = false;
      this.statusCb?.(i, null);
    }
  }

  /**
   * 소스가 끊기거나 다시 여는 중: 링·오차·쿨다운·확인 창을 비우고 상태 보고를 내린다. 적용값은 남긴다.
   * 스틱이 꺼지지 않았으면 오프셋을 그대로 갖고 있고(STATUS 비트 5 = 0), 꺼졌다 켜졌으면 onConnected가 0으로 다시 맞춘다.
   * 여기서 0으로 지우면 FE만 0으로 알게 되어 다음 보정(절대값)이 스틱에 남은 값만큼 튄다
   */
  private suspend(i: StickId): void {
    const { applied } = this.sticks[i];
    this.clearWindow(this.sticks[i]);
    this.sticks[i] = { ...blank(), applied };
    if (this.active[i]) {
      this.active[i] = false;
      this.statusCb?.(i, null);
    }
  }

  /** 소스를 바꾸거나 떼면 모두 잊는다. 같은 소스의 상태 변화(끊김·다시 여는 중)에는 적용값을 남긴다(suspend) */
  setSource(src: InputSource | null): void {
    this.offState?.();
    this.offState = null;
    this.source = src;
    for (const i of STICKS) this.forget(i);
    if (!src) return;
    this.offState = src.onState((s) => {
      if (s !== 'connected') for (const i of STICKS) this.suspend(i);
    });
  }

  /** 연결 직후: 스틱의 오프셋을 0으로 맞춘다(재연결 뒤 스틱 상태를 모르므로). 확인 창은 열지 않는다 */
  onConnected(stickId: StickId): void {
    const src = this.usable();
    if (!src) return;
    const prevDeg = this.sticks[stickId].applied;
    src.sendCommand!(encodeSetYawOffset(0), stickId);
    this.correctionCb?.({ stickId, reason: 'connected', prevDeg, sentDeg: 0, medianDeg: null, madDeg: null, samples: [] });
    this.forget(stickId);
    this.report(stickId);
  }

  /**
   * 꺼지지 않은 스틱이 붙었다(STATUS 비트 5 = 0): 스틱이 가진 오프셋은 그대로 두고, 현재 값을 물어 FE 기억을 맞춘다.
   * 스틱 FW 1.12부터 GET_PARAMS 응답에 0x21(현재 방위각 오프셋)이 들어 있어, subscribeTap이 그 손 적용값에 넣는다.
   * 페이지를 새로 고치면 FE 기억은 0인데 스틱은 값을 갖고 있어 다음 보정(절대값)이 그만큼 튀던 것을 막는다.
   * 0x21이 오지 않으면(FW 1.11 이하) 기억은 그대로다. 확인 창을 열지 않고 쿨다운·링도 건드리지 않는다.
   * 상태를 보고해 두어야 창 없이 온 응답이 이 손에 반영된다(상태 없는 손의 응답은 건너뛴다)
   */
  onLinked(stickId: StickId): void {
    const src = this.usable();
    if (!src) return;
    src.sendCommand!(encodeGetParams(), stickId);
    this.report(stickId);
  }

  /** 링·적용값·쿨다운·확인 창을 비운다(RESET_POSE 뒤 펌웨어 오프셋이 0). 소스가 보낼 수 있으면 0 상태로, 아니면 null */
  reset(stickId?: StickId): void {
    for (const i of stickId === undefined ? STICKS : [stickId]) {
      this.forget(i);
      if (this.usable()) this.report(i);
    }
  }

  /** 드리프트 감시를 멈춘다. 보정·재정렬 중 타격은 샘플이 아니다 */
  pause(): void {
    this.paused = true;
  }

  /** 감시 재개. 링은 비워 옛 앵커 기준 샘플이 섞이지 않게 한다 */
  resume(): void {
    this.paused = false;
    for (const i of STICKS) this.sticks[i].ring = [];
  }

  /**
   * 자동 보정을 켜고 끈다(설정 「패드 위치 자동 보정」). 이미 보낸 오프셋은 그대로 둔다(끄는 순간 패드가 튀지 않게).
   * 바뀔 때 링과 마지막 오차를 비워, 꺼진 동안의 타격이나 옛 샘플이 다음 보정에 섞이지 않게 한다
   */
  setAuto(on: boolean): void {
    if (this.auto === on) return;
    this.auto = on;
    for (const i of STICKS) {
      const s = this.sticks[i];
      s.ring = [];
      s.lastErr = null;
      if (this.active[i]) this.report(i);
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * 즉시 보정(재정렬, PLAY-004 D5): 링을 비우고 applied − errorDeg를 SET_YAW_OFFSET으로 보낸 뒤 확인 창을 연다.
   * 쿨다운은 보지 않는다(사용자가 스네어를 쳐서 명시적으로 요청한 보정)
   */
  correct(stickId: StickId, errorDeg: number): void {
    const src = this.usable();
    if (!src) return;
    const s = this.sticks[stickId];
    const next = wrap180(s.applied - errorDeg);
    src.sendCommand!(encodeSetYawOffset(next), stickId);
    this.correctionCb?.({ stickId, reason: 'realign', prevDeg: s.applied, sentDeg: next, medianDeg: errorDeg, madDeg: null, samples: [] });
    s.applied = next;
    s.lastErr = errorDeg;
    s.lastSentAt = performance.now();
    s.acked = null;
    s.ring = [];
    this.openWindow(stickId);
    this.report(stickId);
  }

  /** 타격 1건을 보고 샘플로 쓸 수 있으면 링에 넣고, 조건이 맞으면 보정을 보낸다 */
  observe(hit: ResolvedHit, profile: CalibrationProfile | null): void {
    if (this.paused || !this.auto) return;
    const src = this.usable();
    if (!src) return;
    if (!isSensorSource(hit.source)) return;
    if (hit.pad === null) return;
    const trusted = hit.judgedBy === 'stick' || hit.judgedBy === 'chart' || (hit.judgedBy === 'pose' && hit.inside === true);
    if (!trusted) return;
    const anchor = profile?.anchors[hit.pad];
    if (!anchor) return;

    // 손 없는 타격(페달)은 방위각 오차가 없다
    if (hit.stickId === null) return;
    const i = hit.stickId;
    const s = this.sticks[i];
    s.ring.push(wrap180(hit.pose.yaw - anchor.yaw));
    if (s.ring.length > DRIFT_WINDOW) s.ring.shift();

    if (s.ring.length >= DRIFT_MIN_SAMPLES) {
      const m = median(s.ring);
      const mad = medianAbsDev(s.ring, m);
      s.lastErr = m;
      const now = performance.now();
      const cooled = s.lastSentAt === null || now - s.lastSentAt >= DRIFT_COOLDOWN_MS;
      if (Math.abs(m) >= DRIFT_MIN_DEG && mad <= DRIFT_MAX_SPREAD_DEG && cooled) {
        const next = wrap180(s.applied - m);
        src.sendCommand!(encodeSetYawOffset(next), i);
        // 링을 비우기 전에 근거 샘플을 넘긴다(콜백이 없으면 복사하지 않는다)
        this.correctionCb?.({ stickId: i, reason: 'drift', prevDeg: s.applied, sentDeg: next, medianDeg: m, madDeg: mad, samples: s.ring.slice() });
        s.applied = next;
        s.lastSentAt = now;
        s.acked = null;
        s.ring = [];
        this.openWindow(i);
      }
    }
    this.report(i);
  }

  /** 테스트용 초기화 */
  resetAll(): void {
    this.offState?.();
    this.offState = null;
    this.source = null;
    this.paused = false;
    this.auto = true;
    for (const i of STICKS) {
      this.clearWindow(this.sticks[i]);
      this.sticks[i] = blank();
      this.active[i] = false;
    }
    this.statusCb = null;
    this.correctionCb = null;
    this.subscribeTap();
  }
}

export const yawDriftMonitor = new YawDriftMonitor();
